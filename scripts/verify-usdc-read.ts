/** Read-only network smoke check; the zero address is not a user's wallet. */
async function main() {
  process.loadEnvFile(".env.local");
  const { getUsdcBalance } = await import("../src/lib/chain");
  await getUsdcBalance("0x0000000000000000000000000000000000000000");
  console.log("PASS: live Base Sepolia RPC, canonical USDC, six decimals, and balanceOf read. No user login, ownership, funding, or transaction verified.");
}
main().catch(() => {
  console.error("FAIL: USDC read/configuration check. Details withheld to protect RPC credentials.");
  process.exitCode = 1;
});
