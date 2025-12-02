import swaggerJsDoc from "swagger-jsdoc";

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
  apis: [
    "./src/routers/admin/admin-account.ts",
    "./src/routers/admin/admin-product.ts",
    "./src/routers/admin/admin-advertisement.ts",
    "./src/routers/admin/admin-order.ts",
    "./src/routers/admin/admin-chatroom.ts",
    "./src/routers/admin/admin-file.ts",
    "./src/routers/admin/admin-system.ts",
  ],
};

export const swaggerSpec = swaggerJsDoc(options);
