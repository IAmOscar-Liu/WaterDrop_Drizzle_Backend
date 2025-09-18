import "dotenv/config";
import fs from "fs/promises";
import path from "path";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../db/schema";

// --- Database Connection ---
const client = postgres(process.env.DATABASE_URL!);
const db = drizzle(client, { schema });

// --- Type Definitions for JSON data ---
interface ProductJson {
  id: string;
  name: string;
  description: string;
  price: number;
  stock: number;
  images: string[];
  ad: string | null;
  category: string | null;
  status: string;
  created_at: number;
  updated_at: number;
}

// --- Manual Category Mapping ---
// Assign categories to products where the category is null in the JSON
const manualCategoryMap: Record<string, string> = {
  行動電源: "3C電子",
  電動曬衣架: "生活用品",
  筋膜槍: "運動用品",
  智能體重計: "健康管理",
  便攜顯示器: "3C電子",
  除濕機: "生活用品",
  電動牙刷: "個人護理",
  高速吹風機: "個人護理",
  自動感應洗手機: "生活用品",
  氣炸烤箱: "廚房用品",
  "智能運動-手環": "3C電子",
  線上外語學習課程: "教育學習",
  香氛擴香石: "生活用品",
  人體工學辦公椅: "家具家飾",
  便攜式果汁機: "廚房用品",
  保濕修護面膜: "美妝保養",
  寵物智能餵食器: "寵物用品",
  多功能料理鍋: "廚房用品",
  無線降噪耳機: "3C電子",
  手沖咖啡壺: "廚房用品",
};

async function seedDatabase() {
  try {
    console.log("🌱 Starting to seed the database...");

    const jsonPath = path.join(__dirname, "product.json");
    const jsonData = await fs.readFile(jsonPath, "utf-8");
    const productData: { products: ProductJson[] } = JSON.parse(jsonData).data;

    const categoryNames = new Set<string>();
    productData.products.forEach((p) => {
      const categoryName = p.category ?? manualCategoryMap[p.name];
      if (categoryName) {
        categoryNames.add(categoryName);
      }
    });

    await db.transaction(async (tx) => {
      console.log(
        "🗑️ Clearing old product, advertisement, and category data..."
      );
      await tx.delete(schema.productsToCategoriesTable);
      await tx.delete(schema.advertisementTable);
      await tx.delete(schema.productTable);
      await tx.delete(schema.categoryTable);

      if (categoryNames.size > 0) {
        const categoryValues = Array.from(categoryNames).map((name) => ({
          name,
        }));
        await tx.insert(schema.categoryTable).values(categoryValues);
        console.log(`🛍️ Seeded ${categoryValues.length} categories.`);
      }

      const allCategories = await tx.query.categoryTable.findMany();
      const categoryIdMap = new Map(allCategories.map((c) => [c.name, c.id]));

      console.log(`📦 Seeding ${productData.products.length} products...`);
      for (const product of productData.products) {
        const [newProduct] = await tx
          .insert(schema.productTable)
          .values({
            sellerId: "b8c5dba2-7099-4bbb-b1a9-1d2e2c5be8ba",
            name: product.name,
            description: product.description,
            price: product.price,
            stock: product.stock,
            images: product.images,
            status: product.status,
            createdAt: new Date(product.created_at * 1000),
            updatedAt: new Date(product.updated_at * 1000),
          })
          .returning();

        if (product.ad)
          await tx.insert(schema.advertisementTable).values({
            productId: newProduct.id,
            title: newProduct.name + " - 廣告",
            video_url: product.ad,
          });

        const categoryName =
          product.category ?? manualCategoryMap[product.name];
        const categoryId = categoryIdMap.get(categoryName);
        if (categoryId)
          await tx
            .insert(schema.productsToCategoriesTable)
            .values({ productId: newProduct.id, categoryId: categoryId });
      }
    });

    console.log("✅ Database seeding completed successfully!");
  } catch (error) {
    console.error("❌ Error during database seeding:", error);
    process.exit(1);
  } finally {
    await client.end();
    console.log("👋 Database connection closed.");
  }
}

seedDatabase();
