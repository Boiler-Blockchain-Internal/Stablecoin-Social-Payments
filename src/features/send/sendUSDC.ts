/**
 * Send USDC to another user by username.
 *
 * Agreed shape; build against this signature.
 *
 * TODO (send owner):
 * 1. Resolve toUsername → wallet_address by reading `users` (getSupabaseBrowser()).
 * 2. Transfer through the Privy SMART WALLET client so gas is sponsored by the paymaster.
 *    Never use the embedded wallet directly. Sketch:
 *
 *      const { client } = useSmartWallets();          // client must come from a hook
 *      const txHash = await client.sendTransaction({
 *        to: USDC_ADDRESS,                              // from "@/lib/chain"
 *        data: encodeFunctionData({
 *          abi: erc20Abi,
 *          functionName: "transfer",
 *          args: [recipientAddress, toUsdcUnits(amount)],
 *        }),
 *      });
 *
 *    Because the client comes from a hook, the real version will probably be exposed as
 *    `useSendUSDC()` returning a function with this same signature.
 * 3. Record it: POST to an API route (e.g. /api/transactions) with the Privy access token,
 *    which inserts into `transactions` with the service role key.
 */
export async function sendUSDC(
  toUsername: string,
  amount: string,
  note?: string,
): Promise<{ txHash: string }> {
  void toUsername;
  void amount;
  void note;
  // FAKE: wait 2s and return a fake hash so UI work can proceed.
  await new Promise((resolve) => setTimeout(resolve, 2000));
  const fakeHash = `0x${"0".repeat(56)}${Date.now().toString(16).padStart(8, "0").slice(-8)}`;
  return { txHash: fakeHash };
}
