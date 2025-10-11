require("dotenv").config();
const authMiddleware = require("./middleware/authMiddleware");
const express = require("express");
const cors = require("cors");
const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Interneefy Backend API is running!");
});

// Company Registration Endpoint
app.post("/api/auth/register-company", async (req, res) => {
  const { companyName, fullName, email, password } = req.body;
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const company = await prisma.company.create({
      data: {
        name: companyName,
        users: {
          // Creates the first user as ADMIN
          create: { fullName, email, password: hashedPassword, role: "ADMIN" },
        },
      },
      include: { users: true },
    });
    // Security note: Exclude password from the response
    const { password: _, ...adminUser } = company.users[0];
    res
      .status(201)
      .json({
        message: "Company and Admin created!",
        company: { ...company, users: [adminUser] },
      });
  } catch (error) {
    console.error("Registration Error:", error);
    res
      .status(500)
      .json({ error: "Registration failed.", details: error.message });
  }
});

// User Login Endpoint
app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(404).json({ error: "User not found." });
    }
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({ error: "Invalid password." });
    }
    const token = jwt.sign(
      { userId: user.id, companyId: user.companyId, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "24h" }
    );
    res
      .status(200)
      .json({ message: "Login successful!", token, role: user.role });
  } catch (error) {
    console.error("Login Error:", error);
    res.status(500).json({ error: "Login failed.", details: error.message });
  }
});

// A test route to see if our middleware works
app.get("/api/test-protected", authMiddleware, (req, res) => {
  res.json({
    message: "Welcome! You are accessing a protected route.",
    user: req.user,
  });
});

// --- NEW ENDPOINT: Get a single user's profile (safe fields only) ---
// This is critical for the Intern dashboard to get the Supervisor's name
app.get("/api/users/:id", authMiddleware, async (req, res) => {
  const userId = parseInt(req.params.id);

  // Users can only view their own profile or users within their company
  if (req.user.role === "INTERN" && req.user.userId !== userId) {
    return res
      .status(403)
      .json({ error: "Forbidden: Interns can only view their own profile." });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId, companyId: req.user.companyId },
      select: {
        id: true,
        fullName: true,
        email: true,
        role: true,
        createdAt: true,
        // Include supervisor details for Interns
        supervisor: { select: { id: true, fullName: true, email: true } },
        // Include list of supervisees for Supervisors
        supervisees: { select: { id: true, fullName: true, email: true } },
      },
    });

    if (!user) return res.status(404).json({ error: "User not found." });
    res.status(200).json(user);
  } catch (error) {
    console.error("Get User Profile Error:", error);
    res.status(500).json({ error: "Failed to retrieve user profile." });
  }
});

// Add a new user (for Admins only)
app.post("/api/users", authMiddleware, async (req, res) => {
  // First, check if the logged-in user is an Admin
  if (req.user.role !== "ADMIN") {
    return res
      .status(403)
      .json({ error: "Forbidden: Only Admins can add users." });
  }

  // NOTE: Added supervisorId for linking Interns to Supervisors
  const { fullName, email, password, role, supervisorId } = req.body;

  // Basic validation
  if (!fullName || !email || !password || !role) {
    return res.status(400).json({ error: "All fields are required." });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = await prisma.user.create({
      data: {
        fullName,
        email,
        password: hashedPassword,
        role,
        supervisorId: role === "INTERN" ? parseInt(supervisorId) || null : null, // Only apply if role is INTERN
        companyId: req.user.companyId,
      },
      // Select only the fields we want to send back (exclude password)
      select: {
        id: true,
        fullName: true,
        email: true,
        role: true,
        createdAt: true,
        supervisorId: true,
      },
    });

    res.status(201).json(newUser);
  } catch (error) {
    console.error("Create User Error:", error);
    // Handle cases where the email might already exist
    if (error.code === "P2002") {
      return res
        .status(409)
        .json({ error: "A user with this email already exists." });
    }
    res.status(500).json({ error: "Failed to create user." });
  }
});

// Get all users in the Admin's company
app.get("/api/users", authMiddleware, async (req, res) => {
  // Check if the user is an Admin or Supervisor
  if (req.user.role === "INTERN") {
    return res
      .status(403)
      .json({ error: "Forbidden: Interns cannot view all users." });
  }

  try {
    const users = await prisma.user.findMany({
      where: {
        companyId: req.user.companyId,
      },
      select: {
        id: true,
        fullName: true,
        email: true,
        role: true,
        createdAt: true,
      },
    });
    res.status(200).json(users);
  } catch (error) {
    console.error("Get All Users Error:", error);
    res.status(500).json({ error: "Failed to retrieve users." });
  }
});

// --- UPDATED ENDPOINT: Create a new task (for Supervisors only) ---
app.post("/api/tasks", authMiddleware, async (req, res) => {
  if (req.user.role !== "SUPERVISOR") {
    return res
      .status(403)
      .json({ error: "Forbidden: Only Supervisors can create tasks." });
  }

  // Added priority and category fields from the updated schema
  const { title, description, dueDate, internId, priority, category } =
    req.body;

  if (!title || !internId || !priority) {
    return res
      .status(400)
      .json({ error: "Title, internId, and priority are required." });
  }

  try {
    const newTask = await prisma.task.create({
      data: {
        title,
        description,
        priority, // Save new priority field
        category, // Save new category field
        dueDate: dueDate ? new Date(dueDate) : null,
        companyId: req.user.companyId,
        supervisorId: req.user.userId,
        internId: parseInt(internId),
      },
    });
    res.status(201).json(newTask);
  } catch (error) {
    console.error("Create Task Error:", error);
    res.status(500).json({ error: "Failed to create task." });
  }
});

// Get all tasks for the currently logged-in user (Interns only)
app.get("/api/tasks", authMiddleware, async (req, res) => {
  if (req.user.role !== "INTERN") {
    return res.status(403).json({
      error: "Forbidden: This route is for Interns to view their tasks.",
    });
  }

  try {
    // Interns only see their assigned tasks
    const tasks = await prisma.task.findMany({
      where: {
        internId: req.user.userId,
      },
      // Include supervisor name for display on the dashboard task list
      include: {
        supervisor: { select: { fullName: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    res.status(200).json(tasks);
  } catch (error) {
    console.error("Get Intern Tasks Error:", error);
    res.status(500).json({ error: "Failed to retrieve tasks." });
  }
});

// --- NEW ENDPOINT: Get a single task by ID (for Task Detail View) ---
app.get("/api/tasks/:id", authMiddleware, async (req, res) => {
  const taskId = parseInt(req.params.id);
  const { userId, role } = req.user;

  try {
    const task = await prisma.task.findUnique({
      where: { id: taskId, companyId: req.user.companyId },
      include: {
        supervisor: { select: { fullName: true } },
        intern: { select: { fullName: true } },
      },
    });

    if (!task) return res.status(404).json({ error: "Task not found." });

    // Security check: Only the assigned intern or the supervisor can view the task details
    const canView =
      role === "ADMIN" ||
      task.internId === userId ||
      task.supervisorId === userId;
    if (!canView) {
      return res
        .status(403)
        .json({
          error: "Forbidden: You do not have permission to view this task.",
        });
    }

    res.status(200).json(task);
  } catch (error) {
    console.error("Get Single Task Error:", error);
    res.status(500).json({ error: "Failed to retrieve task detail." });
  }
});

// --- UPDATED ENDPOINT: Update a task (used by both Intern and Supervisor) ---
app.put("/api/tasks/:id", authMiddleware, async (req, res) => {
  const taskId = parseInt(req.params.id);
  // Allow updates to status (both roles), and details/priority (Supervisor only)
  const { status, title, description, dueDate, priority, category, internId } =
    req.body;
  const { userId, role } = req.user;

  try {
    const task = await prisma.task.findUnique({ where: { id: taskId } });
    if (!task) return res.status(404).json({ error: "Task not found." });

    const updateData = {};
    let canUpdate = false;

    if (role === "INTERN" && task.internId === userId) {
      // Interns can only update status
      if (status) updateData.status = status;
      canUpdate = true;
    } else if (role === "SUPERVISOR" && task.supervisorId === userId) {
      // Supervisors can update status and all details
      if (status) updateData.status = status;
      if (title) updateData.title = title;
      if (description) updateData.description = description;
      if (dueDate) updateData.dueDate = new Date(dueDate);
      if (priority) updateData.priority = priority;
      if (category) updateData.category = category;
      if (internId) updateData.internId = parseInt(internId);
      canUpdate = true;
    } else if (role === "ADMIN") {
      // Admins can update anything (optional, but good practice)
      if (status) updateData.status = status;
      if (title) updateData.title = title;
      if (description) updateData.description = description;
      if (dueDate) updateData.dueDate = new Date(dueDate);
      if (priority) updateData.priority = priority;
      if (category) updateData.category = category;
      if (internId) updateData.internId = parseInt(internId);
      canUpdate = true;
    }

    if (!canUpdate) {
      return res
        .status(403)
        .json({
          error:
            "Forbidden: Insufficient permissions or not the assigned user/supervisor.",
        });
    }

    if (Object.keys(updateData).length === 0) {
      return res
        .status(400)
        .json({ error: "No valid update fields provided." });
    }

    const updatedTask = await prisma.task.update({
      where: { id: taskId },
      data: updateData,
    });

    res.status(200).json(updatedTask);
  } catch (error) {
    console.error("Update Task Error:", error);
    res.status(500).json({ error: "Failed to update task." });
  }
});

// --- NEW ENDPOINT: Get all tasks assigned to a Supervisor's Interns ---
app.get("/api/supervision/tasks", authMiddleware, async (req, res) => {
  if (req.user.role !== "SUPERVISOR") {
    return res
      .status(403)
      .json({ error: "Forbidden: Only Supervisors can access this route." });
  }

  try {
    // Get all tasks where the supervisorId matches the logged-in user's ID
    const tasks = await prisma.task.findMany({
      where: {
        supervisorId: req.user.userId,
        companyId: req.user.companyId,
      },
      // Include intern's name for display in the Supervisor's list
      include: {
        intern: {
          select: { id: true, fullName: true, email: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    res.status(200).json(tasks);
  } catch (error) {
    console.error("Get Supervision Tasks Error:", error);
    res.status(500).json({ error: "Failed to retrieve supervised tasks." });
  }
});

// Submit an evaluation (for Supervisors only)
app.post("/api/evaluations", authMiddleware, async (req, res) => {
  if (req.user.role !== "SUPERVISOR") {
    return res
      .status(403)
      .json({ error: "Forbidden: Only Supervisors can submit evaluations." });
  }

  const {
    internId,
    comments,
    technicalScore,
    communicationScore,
    teamworkScore,
  } = req.body;

  // Basic validation for required fields
  if (
    !internId ||
    technicalScore === undefined ||
    communicationScore === undefined ||
    teamworkScore === undefined
  ) {
    return res
      .status(400)
      .json({ error: "Intern ID and all scores are required." });
  }

  try {
    const newEvaluation = await prisma.evaluation.create({
      data: {
        comments,
        technicalScore,
        communicationScore,
        teamworkScore,
        companyId: req.user.companyId,
        supervisorId: req.user.userId,
        internId: parseInt(internId),
      },
    });
    res.status(201).json(newEvaluation);
  } catch (error) {
    console.error("Submit Evaluation Error:", error);
    res.status(500).json({ error: "Failed to submit evaluation." });
  }
});

// Delete a user (for Admins only)
app.delete("/api/users/:id", authMiddleware, async (req, res) => {
  // 1. Check if the logged-in user is an Admin
  if (req.user.role !== "ADMIN") {
    return res
      .status(403)
      .json({ error: "Forbidden: Only Admins can delete users." });
  }

  const userIdToDelete = parseInt(req.params.id);
  const adminUserId = req.user.userId;

  // 2. Critical Check: Prevent an admin from deleting themselves
  if (userIdToDelete === adminUserId) {
    return res
      .status(403)
      .json({ error: "Forbidden: Admins cannot delete their own account." });
  }

  try {
    // Before deleting the user, we should ensure all dependent records (Tasks, Evals)
    // are handled. Prisma can handle this if you set up 'onDelete: Cascade',
    // but for safety, we'll focus on the primary delete.
    await prisma.user.delete({
      where: {
        id: userIdToDelete,
        // Extra safety: ensure they can only delete users in their own company
        companyId: req.user.companyId,
      },
    });

    res.status(204).send(); // 204 "No Content" is standard for successful DELETE
  } catch (error) {
    console.error("Delete User Error:", error);
    // P2003 = Foreign key constraint failed (user still has tasks/evals assigned)
    if (error.code === "P2003") {
      return res
        .status(409)
        .json({
          error:
            "Cannot delete user. Please reassign or delete their associated tasks and evaluations first.",
        });
    }
    res.status(500).json({ error: "Failed to delete user." });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
