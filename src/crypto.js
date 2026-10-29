export async function generateProofHash(payload) {
  // Exclude proof_hash from its own signature calculation
  const { proof_hash, ...signable } = payload;
  const canonicalString = JSON.stringify(signable, Object.keys(signable).sort());
  const encoder = new TextEncoder();
  const data = encoder.encode(canonicalString);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return `sha256:${hashArray.map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}
