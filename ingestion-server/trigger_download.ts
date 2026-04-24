import { FastEmbedAdapter } from "./src/pipeline/fastembedAdapter";

async function main() {
    console.log("Vector. Triggering download of fast-multilingual-e5-large into local_cache_v2...");
    const adapter = new FastEmbedAdapter({ model: "fast-multilingual-e5-large" });
    // This will call getModel() and trigger the download
    await (adapter as any).getModel();
    console.log("Download complete or already initialized.");
}

main().catch(console.error);
