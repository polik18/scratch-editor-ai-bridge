# Generator Contract

## CLI

```sh
scratch-ai-bridge generate <design.json> --out <new-file.sb3> [--report <report.json>] [--force]
```

The command accepts either Canonical IR v1 JSON or the legacy GameDesign JSON with `spritesDef`. Markdown is
rejected because the previous frontmatter reader did not describe scripts or assets. Existing output files are
preserved unless `--force` is supplied. Output is written atomically after all generation gates pass.

The compatibility entry point `scratch-session new-game --design=<design.json> --output=<directory>` delegates to
the same generator. The old `newGame` command spelling remains accepted.

## GameDesign JSON

GameDesign must include a non-empty `title` and at least one `spritesDef` entry. `sprites` and `blocks`, when
positive, are checked against the declared sprite count and the full nested block count. Variables and lists without
a `sprite` are global Stage data; scoped entries must reference a declared sprite. Each script target must exist.

Block stacks may be written as arrays, and nested inputs are recursively converted. Primitive input values become
Canonical literals. Explicit Canonical inputs support `literal`, `variable`, `list`, `broadcast`, `block`, and
`stack`. Unknown fields and input types are rejected with a JSON path. Raw block `next`/`parent` graph wiring is not
part of GameDesign; use Canonical IR when explicit block graph identities are required.

## Verification gates

Generation returns a JSON object with `format: "scratch-ai-bridge/generation"`, status, output path, manifest,
diagnostics, and these gates:

- `design-input-validation`, `canonical-schema-validation`, `canonical-semantic-validation`
- `scratch-vm-compile-save`
- `archive-validation`, `project-json-validation`, `block-graph-validation`
- `asset-presence-and-md5`
- `scratch-vm-load`, `scratch-vm-save`, `scratch-vm-reload`
- `atomic-output-write` when an output path is requested
- `runtime-behavior`, which remains `not-run` until a deterministic gameplay scenario is run
- `renderer-preview`, which passes when `--preview <stage.png>` captures the official Scratch stage; otherwise `not-run`

A successful result means generation and listed structural/VM gates passed. A renderer preview confirms the Scratch
browser renderer loaded and captured the stage, but does not verify gameplay or Scratch website import. Asset bytes
are checked against their `assetId` MD5; ZIP asset presence alone is not treated as semantic/runtime verification.

## API

```typescript
export interface GeneratorOptions {
  outputFile?: string;
  outputDir?: string;
  reportPath?: string;
  previewPath?: string;
  force?: boolean;
}

export async function generateGame(input: string, options?: GeneratorOptions): Promise<GeneratorResult>;
```

CLI stdout contains only the versioned JSON result. CLI argument errors use exit code 2, generation failures use
exit code 1, and verified generation uses exit code 0. Detailed diagnosis goes in the JSON result and optional
report file.
