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
      cookieAuth: {
        type: "apiKey",
        in: "cookie",
        name: "access_token", // name of your JWT cookie (adjust as needed)
        description:
          "JWT Access Token stored in HttpOnly cookie. Automatically sent with requests after login.",
      },
      requestToken: {
        type: "apiKey",
        in: "cookie",
        name: "request_token", // optional: if you use a separate refresh/request cookie
        description:
          "Temporary request token used for request validation or refreshing JWT session.",
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
      ...(JSON.parse(prismaSchema) as any).definitions,
    },
  },
  security: [
    {
      cookieAuth: [],
      requestToken: [],
    },
  ],
};

const outputFile = "./swagger-output.json";
const routes = ["./app.ts"];

swaggerAutogen({ openapi: "3.1.0" })(outputFile, routes, doc);
