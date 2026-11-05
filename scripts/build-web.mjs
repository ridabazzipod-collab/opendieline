import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { build } from "esbuild";

const result = await build({
  entryPoints: ["web/main.ts"],
  bundle: true,
  minify: true,
  format: "iife",
  target: "es2022",
  write: false,
});
const script = result.outputFiles[0].text.replaceAll("</script", "<\\/script");
const fragment = readFileSync("web/app.html", "utf8").replace("/*__BUNDLE__*/", () => script);

mkdirSync("dist-web", { recursive: true });
writeFileSync("dist-web/fragment.html", fragment);
writeFileSync(
  "dist-web/index.html",
  `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n` +
    `<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n` +
    `</head>\n<body>\n${fragment}\n</body>\n</html>\n`,
);
