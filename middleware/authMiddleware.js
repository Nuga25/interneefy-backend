const jwt = require("jsonwebtoken");

const authMiddleware = (req, res, next) => {
  // 1. Look for the token in the request headers.
  // The standard is to send it as: Authorization: Bearer <token>
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res
      .status(401)
      .json({ error: "Authentication failed: No token provided." });
  }

  const token = authHeader.split(" ")[1]; // Get the token part

  try {
    // 2. Verify the token is valid and not expired.
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // 3. If valid, attach the user's info to the request object.
    // This makes it available to our actual endpoint.
    req.user = decoded;

    // 4. Pass control to the next function in the chain (our endpoint).
    next();
  } catch (error) {
    return res
      .status(401)
      .json({ error: "Authentication failed: Invalid token." });
  }
};

module.exports = authMiddleware;
