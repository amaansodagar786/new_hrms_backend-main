const express = require("express");
const { v4: uuidv4 } = require("uuid");
const Performance = require("../../models/Task/Performance");
const User = require("../../models/User");
const { sendPerformanceEmail, getUserEmail } = require("../../utils/taskEmailService");

const router = express.Router();

// ========== CUSTOM AUTH MIDDLEWARE ==========
router.use(async (req, res, next) => {
    try {
        const jwt = require("jsonwebtoken");
        let token = req.cookies.employeeToken;

        if (token) {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            req.user = decoded;
            return next();
        }

        token = req.cookies.adminToken;
        if (token) {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            req.user = {
                employeeId: decoded.adminId,
                name: "Admin",
                role: "ADMIN"
            };
            return next();
        }

        return res.status(401).json({ success: false, message: "Not authorized" });
    } catch (error) {
        return res.status(401).json({ success: false, message: "Invalid token" });
    }
});

// ========== HELPER: Calculate quarter ==========
const getQuarter = (monthNum) => {
    if (monthNum >= 1 && monthNum <= 3) return "Q1";
    else if (monthNum >= 4 && monthNum <= 6) return "Q2";
    else if (monthNum >= 7 && monthNum <= 9) return "Q3";
    else return "Q4";
};

// ========== HELPER: Calculate overall rating ==========
const calculateOverallRating = (taskCompletion, qualityOfWork, deadlinesMet, behaviorTeamwork) => {
    const sum = taskCompletion + qualityOfWork + deadlinesMet + behaviorTeamwork;
    return parseFloat((sum / 4).toFixed(1));
};

// ========== GET OR CREATE EMPLOYEE PERFORMANCE DOCUMENT ==========
const getOrCreateEmployeePerformance = async (employeeId, employeeName) => {
    let performance = await Performance.findOne({ employeeId });
    if (!performance) {
        performance = new Performance({
            employeeId,
            employeeName,
            reviews: [],
        });
        await performance.save();
    } else if (performance.employeeName !== employeeName) {
        performance.employeeName = employeeName;
        await performance.save();
    }
    return performance;
};

// ========== ADD PERFORMANCE REVIEW ==========
router.post("/add", async (req, res) => {
    try {
        const {
            employeeId,
            employeeName,
            reviewMonth,
            reviewYear,
            taskCompletion,
            qualityOfWork,
            deadlinesMet,
            behaviorTeamwork,
            comments,
            relatedTasks,
        } = req.body;

        const reviewerId = req.user.employeeId;
        const reviewerName = req.user.name;
        const role = req.user.role;

        // Only Manager, HR, Admin can add performance reviews
        if (role !== "MANAGER" && role !== "HR" && role !== "ADMIN") {
            return res.status(403).json({
                success: false,
                message: "Only Managers, HR, and Admin can add performance reviews",
            });
        }

        // Validate required fields
        if (!employeeId || !reviewMonth || !reviewYear) {
            return res.status(400).json({
                success: false,
                message: "Missing required fields: employeeId, reviewMonth, reviewYear",
            });
        }

        // Validate ratings (1-5)
        const ratings = [taskCompletion, qualityOfWork, deadlinesMet, behaviorTeamwork];
        for (const rating of ratings) {
            if (rating && (rating < 1 || rating > 5)) {
                return res.status(400).json({
                    success: false,
                    message: "Ratings must be between 1 and 5",
                });
            }
        }

        // Get or create employee performance document
        const performance = await getOrCreateEmployeePerformance(employeeId, employeeName || "Unknown");

        // Check if already reviewed for this month
        const formattedMonth = `${reviewYear}-${String(reviewMonth).padStart(2, "0")}`;
        const existingReview = performance.reviews.find(r => r.reviewMonth === formattedMonth);

        if (existingReview) {
            return res.status(400).json({
                success: false,
                message: "Performance review already exists for this month",
            });
        }

        // Calculate quarter and overall rating
        const quarter = getQuarter(parseInt(reviewMonth));
        const overallRating = calculateOverallRating(
            taskCompletion || 3,
            qualityOfWork || 3,
            deadlinesMet || 3,
            behaviorTeamwork || 3
        );

        // Generate unique performanceId
        const performanceId = `PERF_${uuidv4()}`;

        // Create new review with performanceId
        const newReview = {
            performanceId,
            reviewMonth: formattedMonth,
            reviewYear: parseInt(reviewYear),
            quarter,
            taskCompletion: taskCompletion || 3,
            qualityOfWork: qualityOfWork || 3,
            deadlinesMet: deadlinesMet || 3,
            behaviorTeamwork: behaviorTeamwork || 3,
            overallRating,
            comments: comments || "",
            relatedTasks: relatedTasks || [],
            reviewedBy: reviewerId,
            reviewedByName: reviewerName,
            createdAt: new Date(),
        };

        performance.reviews.push(newReview);
        await performance.save();

        // Send email notification
        const employeeEmail = await getUserEmail(employeeId);
        if (employeeEmail) {
            await sendPerformanceEmail(
                { employeeId, employeeName: employeeName || "Unknown", employeeEmail },
                newReview,
                reviewerName
            );
        }

        res.status(201).json({
            success: true,
            message: "Performance review added successfully",
            review: newReview,
        });
    } catch (error) {
        console.error("Add performance error:", error);
        res.status(500).json({
            success: false,
            message: "Server error",
            error: error.message,
        });
    }
});

// ========== GET MY PERFORMANCE REVIEWS (Employee) ==========
router.get("/my-reviews", async (req, res) => {
    try {
        const employeeId = req.user.employeeId;
        const { year, month, page = 1, limit = 20 } = req.query;

        const performance = await Performance.findOne({ employeeId });

        if (!performance || performance.reviews.length === 0) {
            return res.json({
                success: true,
                reviews: [],
                pagination: {
                    total: 0,
                    page: parseInt(page),
                    limit: parseInt(limit),
                    totalPages: 0,
                },
            });
        }

        let reviews = [...performance.reviews];

        if (year) {
            reviews = reviews.filter(r => r.reviewYear === parseInt(year));
        }

        if (month) {
            const formattedMonth = `${year}-${String(month).padStart(2, "0")}`;
            reviews = reviews.filter(r => r.reviewMonth === formattedMonth);
        }

        reviews.sort((a, b) => new Date(b.reviewMonth) - new Date(a.reviewMonth));

        const total = reviews.length;
        const skip = (parseInt(page) - 1) * parseInt(limit);
        const paginatedReviews = reviews.slice(skip, skip + parseInt(limit));

        res.json({
            success: true,
            reviews: paginatedReviews,
            pagination: {
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                totalPages: Math.ceil(total / parseInt(limit)),
            },
        });
    } catch (error) {
        console.error("Get my reviews error:", error);
        res.status(500).json({
            success: false,
            message: "Server error",
            error: error.message,
        });
    }
});

// ========== GET SINGLE REVIEW BY PERFORMANCE ID ==========
router.get("/review/:performanceId", async (req, res) => {
    try {
        const { performanceId } = req.params;
        const role = req.user.role;
        const employeeId = req.user.employeeId;

        const result = await Performance.findOne(
            { "reviews.performanceId": performanceId },
            { "reviews.$": 1 }
        );

        if (!result || !result.reviews || result.reviews.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Performance review not found",
            });
        }

        const review = result.reviews[0];

        // Check permission
        const canView = review.employeeId === employeeId || ["HR", "ADMIN", "MANAGER"].includes(role);

        if (!canView) {
            return res.status(403).json({
                success: false,
                message: "Access denied",
            });
        }

        res.json({
            success: true,
            review: {
                ...review,
                employeeId: result.employeeId,
                employeeName: result.employeeName,
            },
        });
    } catch (error) {
        console.error("Get review error:", error);
        res.status(500).json({
            success: false,
            message: "Server error",
            error: error.message,
        });
    }
});

// ========== UPDATE PERFORMANCE REVIEW ==========
router.put("/review/:performanceId", async (req, res) => {
    try {
        const { performanceId } = req.params;
        const {
            taskCompletion,
            qualityOfWork,
            deadlinesMet,
            behaviorTeamwork,
            comments,
        } = req.body;

        const reviewerId = req.user.employeeId;
        const reviewerName = req.user.name;
        const role = req.user.role;

        // Find the document containing the review
        const performance = await Performance.findOne({ "reviews.performanceId": performanceId });

        if (!performance) {
            return res.status(404).json({
                success: false,
                message: "Performance review not found",
            });
        }

        // Find the review index
        const reviewIndex = performance.reviews.findIndex(r => r.performanceId === performanceId);

        if (reviewIndex === -1) {
            return res.status(404).json({
                success: false,
                message: "Review not found",
            });
        }

        const review = performance.reviews[reviewIndex];

        // Check permission (only creator or HR/Admin can update)
        if (review.reviewedBy !== reviewerId && role !== "HR" && role !== "ADMIN") {
            return res.status(403).json({
                success: false,
                message: "You don't have permission to update this review",
            });
        }

        // Update fields
        if (taskCompletion !== undefined) performance.reviews[reviewIndex].taskCompletion = taskCompletion;
        if (qualityOfWork !== undefined) performance.reviews[reviewIndex].qualityOfWork = qualityOfWork;
        if (deadlinesMet !== undefined) performance.reviews[reviewIndex].deadlinesMet = deadlinesMet;
        if (behaviorTeamwork !== undefined) performance.reviews[reviewIndex].behaviorTeamwork = behaviorTeamwork;
        if (comments !== undefined) performance.reviews[reviewIndex].comments = comments;

        // Recalculate overall rating
        const newOverallRating = calculateOverallRating(
            performance.reviews[reviewIndex].taskCompletion,
            performance.reviews[reviewIndex].qualityOfWork,
            performance.reviews[reviewIndex].deadlinesMet,
            performance.reviews[reviewIndex].behaviorTeamwork
        );
        performance.reviews[reviewIndex].overallRating = newOverallRating;

        await performance.save();

        res.json({
            success: true,
            message: "Performance review updated successfully",
            review: performance.reviews[reviewIndex],
        });
    } catch (error) {
        console.error("Update review error:", error);
        res.status(500).json({
            success: false,
            message: "Server error",
            error: error.message,
        });
    }
});

// ========== DELETE PERFORMANCE REVIEW ==========
router.delete("/review/:performanceId", async (req, res) => {
    try {
        const { performanceId } = req.params;
        const role = req.user.role;
        const userId = req.user.employeeId;

        const performance = await Performance.findOne({ "reviews.performanceId": performanceId });

        if (!performance) {
            return res.status(404).json({
                success: false,
                message: "Performance review not found",
            });
        }

        const review = performance.reviews.find(r => r.performanceId === performanceId);

        // Check permission (only creator or HR/Admin can delete)
        if (review.reviewedBy !== userId && role !== "HR" && role !== "ADMIN") {
            return res.status(403).json({
                success: false,
                message: "You don't have permission to delete this review",
            });
        }

        await Performance.updateOne(
            { employeeId: performance.employeeId },
            { $pull: { reviews: { performanceId } } }
        );

        res.json({
            success: true,
            message: "Performance review deleted successfully",
        });
    } catch (error) {
        console.error("Delete review error:", error);
        res.status(500).json({
            success: false,
            message: "Server error",
            error: error.message,
        });
    }
});

// ========== GET TEAM PERFORMANCE (Manager) ==========
router.get("/team-reviews", async (req, res) => {
    try {
        const managerId = req.user.employeeId;
        const role = req.user.role;

        if (role !== "MANAGER") {
            return res.status(403).json({
                success: false,
                message: "Only managers can view team reviews",
            });
        }

        const { year, month, employeeId: filterEmployeeId, page = 1, limit = 20 } = req.query;

        const team = await User.find({ managerId, role: "EMPLOYEE" }).select("employeeId employeeName");
        const teamIds = team.map(m => m.employeeId);

        let targetEmployeeIds = teamIds;
        if (filterEmployeeId && teamIds.includes(filterEmployeeId)) {
            targetEmployeeIds = [filterEmployeeId];
        }

        const performances = await Performance.find({ employeeId: { $in: targetEmployeeIds } }).lean();

        let allReviews = [];
        for (const perf of performances) {
            let reviews = [...perf.reviews];

            if (year) {
                reviews = reviews.filter(r => r.reviewYear === parseInt(year));
            }

            if (month) {
                const formattedMonth = `${year}-${String(month).padStart(2, "0")}`;
                reviews = reviews.filter(r => r.reviewMonth === formattedMonth);
            }

            reviews = reviews.map(r => ({
                ...r,
                employeeId: perf.employeeId,
                employeeName: perf.employeeName,
            }));

            allReviews.push(...reviews);
        }

        allReviews.sort((a, b) => new Date(b.reviewMonth) - new Date(a.reviewMonth));

        const total = allReviews.length;
        const skip = (parseInt(page) - 1) * parseInt(limit);
        const paginatedReviews = allReviews.slice(skip, skip + parseInt(limit));

        res.json({
            success: true,
            reviews: paginatedReviews,
            pagination: {
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                totalPages: Math.ceil(total / parseInt(limit)),
            },
        });
    } catch (error) {
        console.error("Get team reviews error:", error);
        res.status(500).json({
            success: false,
            message: "Server error",
            error: error.message,
        });
    }
});

// ========== GET ALL PERFORMANCE REVIEWS (HR/Admin only) ==========
router.get("/all", async (req, res) => {
    try {
        const role = req.user.role;

        if (role !== "HR" && role !== "ADMIN") {
            return res.status(403).json({
                success: false,
                message: "Access denied. Only HR and Admin can view all reviews.",
            });
        }

        const { employeeId, year, month, page = 1, limit = 20 } = req.query;

        let filter = {};
        if (employeeId) filter.employeeId = employeeId;

        // ✅ ADD .lean() HERE
        const performances = await Performance.find(filter).lean();

        let allReviews = [];
        for (const perf of performances) {
            let reviews = [...perf.reviews];

            if (year) {
                reviews = reviews.filter(r => r.reviewYear === parseInt(year));
            }

            if (month) {
                const formattedMonth = `${year}-${String(month).padStart(2, "0")}`;
                reviews = reviews.filter(r => r.reviewMonth === formattedMonth);
            }

            reviews = reviews.map(r => ({
                ...r,
                employeeId: perf.employeeId,
                employeeName: perf.employeeName,
            }));

            allReviews.push(...reviews);
        }

        allReviews.sort((a, b) => new Date(b.reviewMonth) - new Date(a.reviewMonth));

        const total = allReviews.length;
        const skip = (parseInt(page) - 1) * parseInt(limit);
        const paginatedReviews = allReviews.slice(skip, skip + parseInt(limit));

        res.json({
            success: true,
            reviews: paginatedReviews,
            pagination: {
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                totalPages: Math.ceil(total / parseInt(limit)),
            },
        });
    } catch (error) {
        console.error("Get all reviews error:", error);
        res.status(500).json({
            success: false,
            message: "Server error",
            error: error.message,
        });
    }
});

// ========== GET PERFORMANCE SUMMARY (for dashboard) ==========
router.get("/summary", async (req, res) => {
    try {
        const employeeId = req.user.employeeId;
        const { year } = req.query;

        const performance = await Performance.findOne({ employeeId });

        if (!performance || performance.reviews.length === 0) {
            return res.json({
                success: true,
                summary: {
                    totalReviews: 0,
                    averageOverallRating: 0,
                    averageTaskCompletion: 0,
                    averageQualityOfWork: 0,
                    averageDeadlinesMet: 0,
                    averageBehaviorTeamwork: 0,
                    bestMonth: null,
                },
            });
        }

        let reviews = [...performance.reviews];

        const targetYear = year ? parseInt(year) : new Date().getFullYear();
        reviews = reviews.filter(r => r.reviewYear === targetYear);

        const summary = {
            totalReviews: reviews.length,
            averageOverallRating: reviews.length > 0
                ? parseFloat((reviews.reduce((sum, r) => sum + r.overallRating, 0) / reviews.length).toFixed(1))
                : 0,
            averageTaskCompletion: reviews.length > 0
                ? parseFloat((reviews.reduce((sum, r) => sum + r.taskCompletion, 0) / reviews.length).toFixed(1))
                : 0,
            averageQualityOfWork: reviews.length > 0
                ? parseFloat((reviews.reduce((sum, r) => sum + r.qualityOfWork, 0) / reviews.length).toFixed(1))
                : 0,
            averageDeadlinesMet: reviews.length > 0
                ? parseFloat((reviews.reduce((sum, r) => sum + r.deadlinesMet, 0) / reviews.length).toFixed(1))
                : 0,
            averageBehaviorTeamwork: reviews.length > 0
                ? parseFloat((reviews.reduce((sum, r) => sum + r.behaviorTeamwork, 0) / reviews.length).toFixed(1))
                : 0,
            bestMonth: reviews.sort((a, b) => b.overallRating - a.overallRating)[0] || null,
        };

        res.json({
            success: true,
            summary,
        });
    } catch (error) {
        console.error("Get summary error:", error);
        res.status(500).json({
            success: false,
            message: "Server error",
            error: error.message,
        });
    }
});

module.exports = router;