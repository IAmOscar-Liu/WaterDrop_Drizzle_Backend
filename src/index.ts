import "dotenv/config";
import {
  getTreasureBoxesByUserId,
  openTreasureBox,
  processVideoCompletion,
} from "./repository/treasureBox";
import {
  createUser,
  getDailyStatByUserId,
  getUserByOauthProviderAndOauthId,
  getUsers,
  joinGroupByReferralCode,
} from "./repository/user";
import { listProducts } from "./repository/product";
import { client } from "./lib/initDB";
import { listAdvertisements } from "./repository/advertisement";
import { upsertCartItem, listCartItems } from "./repository/cart";

// createUser({
//   oauthProvider: "google",
//   oauthId: "llkjafdafedadfaf",
//   email: "ddtor@lksdfdd.com",
//   name: "Ian",
//   phone: "0234775599",
// });
// getUsers();
getUserByOauthProviderAndOauthId("google", "dasfafaf22dddddsss");
// joinGroupByReferralCode("JEF1eS", "018dffd0-f397-4085-9413-215aa83e1592");
// getDailyStatByUserId("018dffd0-f397-4085-9413-215aa83e1592");
// processVideoCompletion("018dffd0-f397-4085-9413-215aa83e1592");
// openTreasureBox(
//   "018dffd0-f397-4085-9413-215aa83e1592",
//   "0bfce039-057a-4d4e-aec2-dd4aa333412b"
// );
// getTreasureBoxesByUserId("018dffd0-f397-4085-9413-215aa83e1592");

async function main() {
  try {
    // console.log("--- Listing products (Page 1, Limit 5) ---");
    // const results = await listProducts({ page: 1, limit: 10 });
    // console.log(JSON.stringify(results, null, 2));

    // console.log("\n--- Searching for products with '電源' (Power) ---");
    // const searchResults = await listProducts({
    //   page: 1,
    //   limit: 10,
    //   search: "電源",
    // });
    // console.log(JSON.stringify(searchResults.products.map((p) => p.name)));
    // console.log("\n--- Listing advertisements (Page 1, Limit 5) ---");
    // const adResults = await listAdvertisements({
    //   page: 1,
    //   limit: 20,
    //   shuffle: true,
    // });
    // console.log(JSON.stringify(adResults, null, 2));

    // // 2. Add product to cart with quantity 2
    // await upsertCartItem(
    //   "018dffd0-f397-4085-9413-215aa83e1592",
    //   "05f96562-17aa-4828-8ce4-1003c8d9c6d5",
    //   2
    // );
    // let cart = await listCartItems("018dffd0-f397-4085-9413-215aa83e1592");
    // console.log("Cart contents:", JSON.stringify(cart, null, 2));

    // // 3. Update quantity to 5
    // console.log("\n--- Updating quantity to 5 ---");
    // await upsertCartItem(
    //   "018dffd0-f397-4085-9413-215aa83e1592",
    //   "05f96562-17aa-4828-8ce4-1003c8d9c6d5",
    //   5
    // );
    // cart = await listCartItems("018dffd0-f397-4085-9413-215aa83e1592");

    const cart = await listCartItems("01c5a9d0-6d7a-47be-8788-7ef944feb280");
    console.log("Cart contents:", JSON.stringify(cart, null, 2));
  } catch (error) {
    console.error("An error occurred:", error);
  } finally {
    await client.end();
    console.log("\nDatabase connection closed.");
  }
}

// main();
