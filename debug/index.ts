import * as VRCSL from "vrcsl.js";

async function main() {
  const client = new VRCSL.Client({
    appName: "Example App",
    appDescription: "A test application for VRCSL",
    scopes: [
      VRCSL.Scopes.VRCHAT_ALL
    ],
    tokenStore: new VRCSL.JsonFileStore("token_store.json")
  });

  console.log("Connecting to VRCSL...");
  await client.connect()
  if (!client.isAuthenticated) {
    console.log("Not authenticated, starting authentication flow...")
    await client.register();
  } else {
    console.log("Already authenticated with VRCSL")
  }
  const accounts = await client.getAccounts();

  await client.api(accounts[0]!.userId, "PUT", "/avatars/avtr_586730c7-15d5-4a8b-be26-be81a842e0ac/select", {});
  console.log("Avatar selected successfully");
}

main();