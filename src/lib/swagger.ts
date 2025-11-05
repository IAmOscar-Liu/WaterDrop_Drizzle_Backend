import swaggerJsDoc from "swagger-jsdoc";

const options: swaggerJsDoc.Options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Water drop API",
      version: "1.0.0",
      description:
        "This is a simple CRUD API application made with Express and documented with Swagger",
    },
  },
  apis: [
    "./src/routers/admin/admin-account.ts",
    "./src/routers/admin/admin-product.ts",
    "./src/routers/admin/admin-advertisement.ts",
    "./src/routers/admin/admin-file.ts",
  ],
};

export const swaggerSpec = swaggerJsDoc(options);
