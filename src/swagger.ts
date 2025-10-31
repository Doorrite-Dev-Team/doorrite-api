import swaggerAutogen from "swagger-autogen";
const prismaSchema = require("./json-schema.json");

const doc = {
  $schema: "http://json-schema.org/draft-07/schema#",
  openapi: "3.1.0",
  info: {
    title: "Doorrite API",
    description: "All API endpoints for the Doorrite food delivery system.",
    version: "1.0.0",
  },
  servers: [
    { url: "http://localhost:4000", description: "Local development server" },
    {
      url: "https://doorrite-api.onrender.com",
      description: "Production server",
    },
  ],
  tags: [
    { name: "Auth", description: "Authentication endpoints" },
    { name: "User", description: "Customer endpoints" },
    { name: "Vendor", description: "Vendor endpoints" },
    { name: "Product", description: "Product endpoints" },
    { name: "Order", description: "Order endpoints" },
    { name: "Admin", description: "Administration endpoints" },
    { name: "Rider", description: "Rider endpoints" },
    { name: "Payment", description: "Payment endpoints" },
  ],
  components: {
    securitySchemes: {
      // Setup for Bearer Token authorization
      BearerAuth: {
        type: "http", // Specifies the authentication scheme is HTTP-based
        scheme: "bearer", // Specifies the scheme is 'Bearer'
        bearerFormat: "JWT", // Optional: indicates that the token is a JWT
        description:
          "Enter the JWT token prefixed with 'Bearer ' (e.g., 'Bearer abc.xyz.123').",
      },
    },
    schemas: {
      Login: {
        type: "object",
        properties: {
          email: { type: "string", example: "admin@example.com" },
          password: { type: "string", example: "securepassword" },
        },
      },
      CreateUser: {
        type: "object",
        properties: {
          fullName: { type: "string", example: "Jane Doe" },
          email: { type: "string", example: "jane@example.com" },
          phoneNumber: { type: "string", example: "+2348012345678" },
          password: { type: "string", example: "securepassword" },
        },
      },
      ...(JSON.parse(JSON.stringify(prismaSchema)) as any).definitions,
    },
  },
  security: [
    // Apply the BearerAuth scheme globally
    {
      BearerAuth: [],
    },
  ],
};

const outputFile = "./swagger-output.json";
const routes = ["./app.ts"];

swaggerAutogen({ openapi: "3.1.0" })(outputFile, routes, doc);
