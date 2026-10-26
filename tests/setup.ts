import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { plugin } from "bun";
import { transformAsync } from "@babel/core";
import solid from "@solidjs/babel-plugin";

GlobalRegistrator.register();

// Bun's JSX transform targets React; use the real Solid 2 compiler for TSX.
plugin({
  name: "solid-2-tests",
  setup(build) {
    build.onLoad({ filter: /\.tsx$/ }, async ({ path }) => {
      const result = await transformAsync(await Bun.file(path).text(), {
        filename: path,
        plugins: [[solid, { generate: "dom" }]],
        presets: [["@babel/preset-typescript", { allExtensions: true, isTSX: true }]],
      });
      return { contents: result!.code!, loader: "js" };
    });
  },
});
