import swaggerAutogen from "swagger-autogen";

const doc = {
  info: {
    title: "Doorrite API",
    description: "Contain All API for the food delivery system",
  },
  host: "localhost:4000",
};

const outputFile = "./swagger-output.json";
const routes = ["./modules/users/user.route.ts"];

/* NOTE: If you are using the express Router, you must pass in the 'routes' only the 
root file where the route starts, such as index.js, app.js, routes.js, etc ... */

swaggerAutogen()(outputFile, routes, doc);
