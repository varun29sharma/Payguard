export async function probeBackend(url = "http://localhost:3000") {
  try {
    // Use mode:'no-cors' to avoid CORS preflight errors in the console for misconfigured servers.
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 2000);
    await fetch(url, {
      method: "GET",
      mode: "no-cors",
      signal: controller.signal,
    });
    clearTimeout(id);
    return true;
  } catch (e) {
    return false;
  }
}
