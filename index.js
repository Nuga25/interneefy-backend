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
          create: { fullName, email, password: hashedPassword, role: "ADMIN" },
        },
      },
      include: { users: true },
    });
    res.status(201).json({ message: "Company and Admin created!", company });
  } catch (error) {
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
    res.status(200).json({ message: "Login successful!", token });
  } catch (error) {
    res.status(500).json({ error: "Login failed.", details: error.message });
  }
});

// A test route to see if our middleware works
app.get("/api/test-protected", authMiddleware, (req, res) => {
  // If the code reaches here, it means the middleware authenticated the user successfully.
  res.json({
    message: "Welcome! You are accessing a protected route.",
    user: req.user, // This is the user info we attached in the middleware
  });
});

// Add a new user (for Admins only)
app.post("/api/users", authMiddleware, async (req, res) => {
  // First, check if the logged-in user is an Admin
  if (req.user.role !== "ADMIN") {
    return res
      .status(403)
      .json({ error: "Forbidden: Only Admins can add users." });
  }

  const { fullName, email, password, role } = req.body;

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
        // Associate the new user with the Admin's company
        companyId: req.user.companyId,
      },
    });

    // Don't send the password back in the response
    delete newUser.password;
    res.status(201).json(newUser);
  } catch (error) {
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
  // Check if the user is an Admin
  if (req.user.role !== "ADMIN") {
    return res
      .status(403)
      .json({ error: "Forbidden: Only Admins can view all users." });
  }

  try {
    const users = await prisma.user.findMany({
      where: {
        // Only find users that belong to the same company as the logged-in Admin
        companyId: req.user.companyId,
      },
      // Select only the fields we want to send back (exclude password)
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
    res.status(500).json({ error: "Failed to retrieve users." });
  }
});

// Create a new task (for Supervisors only)
app.post("/api/tasks", authMiddleware, async (req, res) => {
  if (req.user.role !== "SUPERVISOR") {
    return res
      .status(403)
      .json({ error: "Forbidden: Only Supervisors can create tasks." });
  }

  const { title, description, dueDate, internId } = req.body;

  if (!title || !internId) {
    return res.status(400).json({ error: "Title and internId are required." });
  }

  try {
    const newTask = await prisma.task.create({
      data: {
        title,
        description,
        dueDate: dueDate ? new Date(dueDate) : null,
        companyId: req.user.companyId,
        supervisorId: req.user.userId,
        internId: parseInt(internId),
      },
    });
    res.status(201).json(newTask);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to create task." });
  }
});

// Get all tasks for the currently logged-in user (for Interns)
app.get("/api/tasks", authMiddleware, async (req, res) => {
  if (req.user.role !== "INTERN") {
    return res.status(403).json({
      error: "Forbidden: Only Interns can view their tasks this way.",
    });
  }

  try {
    const tasks = await prisma.task.findMany({
      where: {
        internId: req.user.userId,
      },
    });
    res.status(200).json(tasks);
  } catch (error) {
    res.status(500).json({ error: "Failed to retrieve tasks." });
  }
});

// Update a task's status (for Interns only)
app.put("/api/tasks/:taskId", authMiddleware, async (req, res) => {
  if (req.user.role !== "INTERN") {
    return res
      .status(403)
      .json({ error: "Forbidden: Only Interns can update their tasks." });
  }

  const { taskId } = req.params;
  const { status } = req.body;

  if (!status) {
    return res.status(400).json({ error: "Status is required." });
  }

  try {
    // First, verify the task belongs to the intern trying to update it
    const task = await prisma.task.findFirst({
      where: {
        id: parseInt(taskId),
        internId: req.user.userId,
      },
    });

    if (!task) {
      return res.status(404).json({
        error: "Task not found or you do not have permission to update it.",
      });
    }

    // Now update the task
    const updatedTask = await prisma.task.update({
      where: {
        id: parseInt(taskId),
      },
      data: {
        status,
      },
    });
    res.status(200).json(updatedTask);
  } catch (error) {
    res.status(500).json({ error: "Failed to update task." });
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

  if (!internId) {
    return res.status(400).json({ error: "Intern ID is required." });
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
    console.error(error);
    res.status(500).json({ error: "Failed to submit evaluation." });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
