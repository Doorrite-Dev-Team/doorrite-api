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
  ],
};

const outputFile = "./swagger-output.json";
const routes = ["./app.ts"]; // Pointing to the app's entry point is the most robust way to capture all routes.

/* NOTE: If you are using the express Router, you must pass in the 'routes' only the
root file where the route starts, such as index.js, app.js, routes.js, etc ... */

swaggerAutogen({ openapi: "3.0.0" })(outputFile, routes, doc);
