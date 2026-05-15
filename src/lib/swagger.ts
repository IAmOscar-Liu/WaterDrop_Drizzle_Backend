import swaggerJsDoc from "swagger-jsdoc";
import path from "path";

const routerFileExtension = __filename.endsWith(".js") ? "js" : "ts";
const adminRouterDocsPath = path.resolve(
  __dirname,
  `../routers/admin/*.${routerFileExtension}`,
);

const options: swaggerJsDoc.Options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Water drop API",
      version: "1.0.0",
      description:
        "This is the documentation for the Water drop API, which provides endpoints for managing products, orders, advertisements, and user accounts.",
    },
  },
  apis: [adminRouterDocsPath],
};

export const swaggerSpec = swaggerJsDoc(options);
