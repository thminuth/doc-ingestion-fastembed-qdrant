import { EmbeddingModel, FlagEmbedding } from "fastembed";

async function main() {
  try {
    const embedder = await FlagEmbedding.init({
      model: EmbeddingModel.MLE5Large,
    });
    const models = embedder.listSupportedModels();
    console.log(JSON.stringify(models, null, 2));
  } catch (err) {
    console.error(err);
  }
}

main();
