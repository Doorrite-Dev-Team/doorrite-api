import swaggerAutogen from "swagger-autogen";

const doc = {
  info: {
    title: "Doorrite API",
    description: "Contain All API for the food delivery system",
  },
  host: "localhost:4000",
  basePath: "/api/v1",
  schemes: ["http"],
};

const outputFile = "./swagger-output-2.json";
const routes = [
  "./modules/user/user.routes.ts",
  "./modules/auth/auth.routes.ts",
];

/* NOTE: If you are using the express Router, you must pass in the 'routes' only the 
root file where the route starts, such as index.js, app.js, routes.js, etc ... */

swaggerAutogen()(outputFile, routes, doc);

