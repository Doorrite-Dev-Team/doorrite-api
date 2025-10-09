import swaggerAutogen from "swagger-autogen";

const doc = {
  info: {
    title: "Doorrite API",
    description: "Contain All API for the food delivery system",
    version: "1.0.0",
  },
  servers: [
    {
      url: "http://localhost:4000",
      description: "Local development server",
    },
    {
      url: "https://doorrite-api.onrender.com",
      description: "Production server",
    },
  ],
  tags: [
    {
      name: "Auth",
      description: "Authentication endpoints (users, vendors, riders)",
    },
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
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
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
      PaymentIntent: {
        type: "object",
        properties: {
          orderId: { type: "string", example: "order_abc123" },
        },
      },
      ConfirmPayment: {
        type: "object",
        properties: {
          reference: { type: "string", example: "psk_abc123" },
        },
      },
      RefundRequest: {
        type: "object",
        properties: {
          amount: { type: "number", example: 1000 },
          reason: { type: "string", example: "Customer requested refund" },
        },
      },
    },
  },
};

const outputFile = "./swagger-output.json";
const routes = ["./app.ts"]; // Pointing to the app's entry point is the most robust way to capture all routes.

/* NOTE: If you are using the express Router, you must pass in the 'routes' only the
root file where the route starts, such as index.js, app.js, routes.js, etc ... */

swaggerAutogen({ openapi: "3.0.0" })(outputFile, routes, doc);
