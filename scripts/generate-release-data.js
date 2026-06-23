import fs from "fs/promises";
import path from "path";
import url from "url";

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.resolve(__filename, "../..");

async function generateReleaseData() {
  try {
    const response = await fetch(
      "https://api.github.com/repos/zmkfirmware/zmk-studio/releases/latest",
      {
        headers: process.env.GITHUB_TOKEN
          ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
          : {},
      },
    );
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    const dataFilePath = path.resolve(
      __dirname,
      "src",
      "data",
      "release-data.json",
    );
    await fs.mkdir(path.dirname(dataFilePath), { recursive: true });
    await fs.writeFile(dataFilePath, JSON.stringify(data));

    console.log("Release data generated successfully!");
  } catch (error) {
    // Network/GitHub-API failures (e.g. 504, rate limit) must not break the
    // build — this data is only the upstream version label for the download
    // page. Fall back to the previously-fetched cache if present.
    const dataFilePath = path.resolve(__dirname, "src", "data", "release-data.json");
    try {
      await fs.access(dataFilePath);
      console.warn(
        `Release data fetch failed (${error.message}); using cached ${dataFilePath}.`,
      );
    } catch {
      // No cache either — write a harmless placeholder so the build proceeds.
      await fs.mkdir(path.dirname(dataFilePath), { recursive: true });
      await fs.writeFile(dataFilePath, JSON.stringify({ tag_name: "", assets: [] }));
      console.warn(
        `Release data fetch failed (${error.message}) and no cache; wrote placeholder.`,
      );
    }
  }
}

generateReleaseData();
