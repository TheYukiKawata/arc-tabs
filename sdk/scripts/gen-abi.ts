import { $ } from "bun";

const contractsDir = new URL("../../contracts/", import.meta.url).pathname;
const artifact = await $`forge inspect Tabs abi --json`.cwd(contractsDir).json();
const bytecode = (await $`forge inspect Tabs bytecode`.cwd(contractsDir).text()).trim();

await Bun.write(
  new URL("../src/generated.ts", import.meta.url),
  `export const tabsAbi = ${JSON.stringify(artifact, null, 2)} as const;\n\nexport const tabsBytecode = "${bytecode}" as const;\n`,
);
