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
    tags: [
      { name: "Account", description: "Administrator authentication and account management" },
      { name: "Account Wallet", description: "Seller wallet balances and funding transactions" },
      { name: "Dashboard", description: "Seller-scoped dashboard and activity reporting" },
      { name: "Product", description: "Product and product-variant management" },
      { name: "Advertisement", description: "Advertisement management and coin accounting" },
      { name: "Order", description: "Order management" },
      { name: "Delivery", description: "Delivery and logistics management" },
      { name: "Refund", description: "Refund management" },
      { name: "Chatroom", description: "Customer-support chat management" },
      { name: "Sidebar Notifications", description: "Per-account admin navigation badges" },
      { name: "File", description: "File uploads" },
      { name: "System", description: "System configuration and reference data" },
    ],
  },
  apis: [adminRouterDocsPath],
};

export const swaggerSpec = swaggerJsDoc(options);
