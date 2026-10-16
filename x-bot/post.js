const posts = [
  "Blockchain technology is evolving quickly. Learning the fundamentals helps people ask better questions and assess claims carefully. #Blockchain",
  "Digital assets carry risk. Take time to understand volatility, custody, and the possibility of loss before making financial decisions. #DigitalAssets",
  "A useful habit in crypto: verify information from reliable sources, protect your account credentials, and be cautious of promises of guaranteed returns. #CryptoSafety",
  "Blockchain is more than price charts. Its applications, limitations, security assumptions, and governance all deserve careful study. #Blockchain",
  "At AlpsCoinChain Investment Ventures, we aim to share educational insights and company updates about blockchain technology and digital assets.",
  "Security starts with the basics: use unique passwords, enable multifactor authentication, and never share private keys or recovery phrases. #CryptoSafety",
  "When researching a digital-asset project, review its documentation, team claims, risks, and independent sources. Never rely on hype alone. #DYOR",
  "No investment is risk-free, and returns are never guaranteed. Independent research and a clear understanding of risk matter. #FinancialEducation",
  "Curiosity is a good starting point for learning about blockchain. Start with how distributed ledgers work, then explore their trade-offs and use cases. #Learn",
  "Beware of unsolicited messages asking you to send crypto, reveal recovery phrases, or pay a fee to unlock supposed profits. #ScamAwareness",
  "Good technology decisions consider both benefits and limitations. Blockchain projects should be assessed on evidence, security, utility, and transparency.",
  "Before using any digital-asset service, check its identity, terms, fees, security practices, and the rules that apply where you live.",
  "A simple security rule: legitimate support should never need your wallet seed phrase or private key. Keep them private, always. #CryptoSafety",
  "Digital-asset markets can be highly volatile. Only make decisions after understanding the risks and considering your own circumstances. #DigitalAssets",
  "We're building the AlpsCoinChain presence to share educational material, relevant industry developments, and accurate company updates. #Blockchain",
  "Research claims before sharing them. Check dates, original sources, and whether the evidence actually supports the conclusion. #DYOR",
  "Strong online security is a habit: update devices, use multifactor authentication, and verify website addresses before signing in.",
  "Blockchain systems involve trade-offs in scalability, decentralization, privacy, and security. Understanding those trade-offs leads to better conversations.",
  "Be wary of pressure to act immediately on an investment opportunity. Take time to verify facts and seek independent advice when appropriate.",
  "Digital assets are a developing field. Education should include both potential applications and practical risks, not just optimistic headlines.",
  "AlpsCoinChain Investment Ventures shares company updates and educational perspectives on blockchain technology and digital assets."
];

async function main() {
  const token = process.env.X_USER_ACCESS_TOKEN;
  if (!token) {
    throw new Error("Missing X_USER_ACCESS_TOKEN secret. Add an OAuth 2.0 user access token with tweet.write permission in GitHub Actions secrets.");
  }

  // Select a deterministic post for the current UTC date and scheduled hour,
  // so a retry during the same hour does not select different content.
  const now = new Date();
  const dayOfYear = Math.floor((Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) -
    Date.UTC(now.getUTCFullYear(), 0, 1)) / 86400000);
  const slot = Math.floor(now.getUTCHours() / 5);
  const index = (dayOfYear * 3 + slot) % posts.length;
  const text = posts[index];

  const response = await fetch("https://api.x.com/2/tweets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ text })
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const safeBody = JSON.stringify(body);
    throw new Error(`X API request failed with HTTP ${response.status}: ${safeBody}`);
  }

  console.log(JSON.stringify({
    status: "published",
    postId: body?.data?.id ?? null,
    postedAt: now.toISOString(),
    postIndex: index
  }));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
