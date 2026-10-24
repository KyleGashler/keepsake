import { defineConfig } from "oxlint";

export default defineConfig({
  options: {
    typeAware: true,
    reportUnusedDisableDirectives: "error",
  },
  categories: {
    correctness: "error",
    suspicious: "error",
    perf: "error",
    restriction: "error",
    style: "error",
  },
  env: {
    builtin: true,
  },
  // metro.config.js is CommonJS because Metro loads it; uniwind-types.d.ts is generated.
  ignorePatterns: ["**/dist/**", "design/**", "app/metro.config.js", "app/src/uniwind-types.d.ts"],
  overrides: [
    {
      files: ["**/*.ts", "**/*.tsx"],
      plugins: ["import", "jsdoc", "node", "promise", "typescript", "unicorn"],
      rules: {
        // ## Category: correctness
        //
        "no-unused-vars": [
          "error",
          {
            ignoreRestSiblings: true,
            argsIgnorePattern: "^_",
            varsIgnorePattern: "^_",
            destructuredArrayIgnorePattern: "^_",
          },
        ],
        // Anything turned off below is because TypeScript already handles it.
        "constructor-super": "off",
        "getter-return": "off",
        "no-class-assign": "off",
        "no-const-assign": "off",
        "no-dupe-class-members": "off",
        "no-dupe-keys": "off",
        "no-func-assign": "off",
        "no-import-assign": "off",
        "no-new-native-nonconstructor": "off",
        "no-obj-calls": "off",
        "no-setter-return": "off",
        "no-this-before-super": "off",
        "no-unreachable": "off",
        "no-unsafe-negation": "off",
        "no-with": "off",

        // ## Category: suspicious
        //
        // jsdoc is optional in our code base, so we shouldn't _require_ this.
        "jsdoc/require-yields": "off",
        "no-underscore-dangle": [
          "error",
          {
            // Only names owned by third-party APIs belong here. These are
            // Prisma's aggregate keys.
            allow: ["_all", "_avg", "_count", "_max", "_min", "_sum"],
          },
        ],
        // Only a mid-chain `then` that returns nothing starves the next one.
        "promise/always-return": ["error", { ignoreLastCallback: true }],
        // Oxlint recommends leaning on TS `noImplicitReturns` instead.
        "typescript/consistent-return": "off",
        // `JobHandler<"ai.transcribe">` says which job it handles, even while
        // that's the only job type and so equals the default.
        "typescript/no-unnecessary-type-arguments": "off",
        // Redundant. `typescript/consistent-type-assertions` with
        // `assertionStyle` set to `never` covers this and more.
        "typescript/no-unsafe-type-assertion": "off",

        // ## Category: perf
        //
        // Too many false positives. If this becomes a problem, we can revisit.
        "no-await-in-loop": "off",
        // We use this everywhere effectively. More annoying than helpful.
        "oxc/no-map-spread": "off",

        // ## Category: restriction
        //
        // The goal is 20 minimum. Anything higher is shameful.
        complexity: ["error", { max: 40, variant: "modified" }],
        // Implementations of an interface (`StorageProvider`, `Transcriber`)
        // don't always need `this`.
        "class-methods-use-this": ["error", { ignoreClassesWithImplements: "all" }],
        // Named exports everywhere, except where Expo Router requires a
        // default export.
        "import/no-default-export": "off",
        "import/no-named-export": "off",
        // The server is Node.
        "import/no-nodejs-modules": "off",
        // `import * as ImagePicker` is how Expo modules are documented.
        "import/no-namespace": "off",
        // `../lib/prisma.js` is how a small codebase without path aliases
        // imports.
        "import/no-relative-parent-imports": "off",
        // All have been false positives.
        "no-bitwise": "off",
        // Comparing for both null and undefined is awesome, not bad.
        "no-eq-null": "off",
        // More obnoxious than useful.
        "no-plusplus": "off",
        // We like to live dangerously.
        "no-undefined": "off",
        // Only useful in a truly vanilla environment.
        "no-use-before-define": "off",
        // Other TypeScript rules need this to be off.
        "no-void": "off",
        // Config reads `process.env` where it's used. There's no env module to
        // funnel it through.
        "node/no-process-env": "off",
        // We use modern Node.
        "node/no-top-level-await": "off",
        // We use async/await.
        "oxc/no-async-await": "off",
        // Express 5 sends a rejected handler's error to the error middleware.
        "oxc/no-async-endpoint-handlers": "off",
        // We like us some optional chaining
        "oxc/no-optional-chaining": "off",
        // We use prop spreads.
        "oxc/no-rest-spread-properties": "off",
        // Revisit if build times get too slow.
        "typescript/explicit-function-return-type": "off",
        // Interesting, but not a problem yet.
        "typescript/explicit-member-accessibility": "off",
        // Revisit if build times get too slow.
        "typescript/explicit-module-boundary-types": "off",
        // Redundant; already handled by `typescript/consistent-type-assertions`
        // and `typescript/no-non-null-assertion`.
        "typescript/non-nullable-type-assertion-style": "off",
        // `constructor(private readonly db: PrismaClient)` is how the
        // providers and queue take their dependencies.
        "typescript/parameter-properties": "off",
        // Revisit if build times get too slow.
        "typescript/promise-function-async": "off",
        // forEach is fine in most cases (until it's not).
        "unicorn/no-array-for-each": "off",
        // Reduce is awesome.
        "unicorn/no-array-reduce": "off",
        // Preference that doesn't really help anything.
        "unicorn/prefer-number-properties": "off",

        // ## Category: style
        //
        // A matter of taste, and not worth the churn.
        "arrow-body-style": "off",
        // Noise. Commented-out code and URLs trip it.
        "capitalized-comments": "off",
        // Guard clauses read best as `if (!x) return;`.
        curly: ["error", "multi-line"],
        // Can't be limited to top-level functions, so it flags the lambdas we
        // want inside components.
        "func-style": "off",
        // Short names like `i`, `a`/`b` and `tx` are fine.
        "id-length": "off",
        // Grouping exports at the bottom of a file splits each one from its
        // doc comment.
        "import/exports-last": "off",
        "import/group-exports": "off",
        "import/prefer-default-export": "off",
        // A matter of taste.
        "import/consistent-type-specifier-style": "off",
        // Every fix is a hand refactor. Review enforces the "no mutable holder"
        // pattern instead.
        "init-declarations": "off",
        // `complexity` covers this.
        "max-statements": "off",
        "max-params": ["error", { max: 5 }],
        // Flags `Router()` from Express.
        "new-cap": ["error", { capIsNew: false }],
        // We like guard-clause `continue`.
        "no-continue": "off",
        "no-implicit-coercion": ["error", { allow: ["!!", "+"] }],
        // Far too noisy to be useful.
        "no-magic-numbers": "off",
        // Ternaries are fine. `no-nested-ternary` catches the bad ones.
        "no-ternary": "off",
        // False positives.
        "node/callback-return": "off",
        // Scripts and the local-disk provider use sync fs on purpose.
        "node/no-sync": "off",
        // One declaration per line.
        "one-var": ["error", "never"],
        // A matter of taste.
        "prefer-destructuring": "off",
        // Numbered groups are fine for short patterns.
        "prefer-named-capture-group": "off",
        // Wrapping callback APIs needs `new Promise`.
        "promise/avoid-new": "off",
        // Flags Express's `(err, req, res, next)` handler and `server.close(cb)`.
        "promise/prefer-await-to-callbacks": "off",
        // A top-level `.catch()` on a fire-and-forget promise reads better
        // than an async IIFE.
        "promise/prefer-await-to-then": "off",
        // Not worth the churn.
        "sort-imports": "off",
        // Key order should follow meaning, not the alphabet.
        "sort-keys": "off",
        "typescript/consistent-type-assertions": [
          "error",
          {
            assertionStyle: "never",
          },
        ],
        // Matches how the code base already imports types.
        "typescript/consistent-type-imports": [
          "error",
          { fixStyle: "inline-type-imports" },
        ],
        // `type` and `interface` both have their place, and Express's
        // `Request` augmentation needs `interface`.
        "typescript/consistent-type-definitions": "off",
        // Not worth the churn.
        "unicorn/catch-error-name": "off",
        // Flags `this.name = new.target.name`.
        "unicorn/custom-error-definition": "off",
        // Server modules that hold a class (`PostgresJobQueue.ts`) are named
        // after it. See the server override for the PascalCase allowance.
        "unicorn/filename-case": ["error", { case: "kebabCase" }],
        // `(await res.json()).field` reads fine.
        "unicorn/no-await-expression-member": "off",
        // `no-nested-ternary` covers it.
        "unicorn/no-nested-ternary": "off",
        // Prisma uses `null`.
        "unicorn/no-null": "off",
        // Lowercase hex is the norm, including the theme's colors.
        "unicorn/number-literal-case": "off",
        // A matter of taste.
        "unicorn/numeric-separators-style": "off",
        // Re-exports through an `index.ts` read better as import-then-export.
        "unicorn/prefer-export-from": "off",
        // `window` is idiomatic in client code.
        "unicorn/prefer-global-this": "off",
        // `no-case-declarations` already covers the risky case.
        "unicorn/switch-case-braces": "off",

        // ## Category: pedantic
        //
        "no-array-constructor": "error",
        "no-case-declarations": "error",
        "no-fallthrough": "error",
        "no-prototype-builtins": "error",
        "typescript/ban-ts-comment": "error",
        "typescript/no-unsafe-function-type": "error",
        "typescript/no-unsafe-member-access": "error",
        // Catches a new Prisma enum value (`MediaType`, `JobStatus`) that a
        // `switch` forgot.
        "typescript/switch-exhaustiveness-check": [
          "error",
          { considerDefaultExhaustiveForUnions: true },
        ],

        // ## Category: nursery
        //
        "import/no-cycle": "error",
      },
    },
    {
      files: ["app/**"],
      plugins: ["react"],
      env: {
        browser: true,
      },
      rules: {
        // ## Category: correctness
        //
        // The React Compiler isn't enabled (`experiments.reactCompiler` in
        // app.json). These only report code the compiler can't optimize.
        "react/invariant": "off",
        "react/todo": "off",

        // ## Category: suspicious
        //
        // React Native's `Alert.alert` isn't the browser's `alert`.
        "no-alert": "off",
        // Expo Router's `tabBarIcon: ({ color }) => <Ionicons … />` is a render
        // prop, not a component defined during render.
        "react/no-unstable-nested-components": ["error", { allowAsProps: true }],
        // `expo-status-bar` takes `style="light"`.
        "react/style-prop-object": ["error", { allow: ["StatusBar"] }],

        // ## Category: restriction
        //
        // React Native styles every component through `style`.
        "react/forbid-component-props": "off",
        // TypeScript only allows JSX in .tsx anyway.
        "react/jsx-filename-extension": "off",
        // React Native has no `<Text>`-less strings, and copy lives inline.
        "react/jsx-no-literals": "off",
        // Small, private sub-components live next to the screen that uses them.
        "react/no-multi-comp": "off",

        // ## Category: style
        //
        // Screens are deep JSX trees by nature.
        "react/jsx-max-depth": "off",
        // The new JSX transform doesn't need `React` in scope.
        "react/react-in-jsx-scope": "off",
        // `const [source] = useState(uri)` is how we pin a prop's first value.
        "react/hook-use-state": "off",
        // `onRefresh={refetch}` says what it does better than `handleRefresh`.
        "react/jsx-handler-names": "off",
      },
    },
    {
      files: ["server/**"],
      // Already enabled above, but oxlint drops a plugin rule's options when
      // the plugin isn't declared in the same override.
      plugins: ["import", "unicorn"],
      env: {
        node: true,
      },
      rules: {
        // ## Category: style
        //
        // Class modules are named after their class.
        "unicorn/filename-case": [
          "error",
          { cases: { kebabCase: true, pascalCase: true } },
        ],

        // ## Custom
        //
        // Node's ESM loader needs the `.js` on relative imports, and
        // `moduleResolution: "Bundler"` lets tsc compile without it.
        "import/extensions": [
          "error",
          "always",
          { ignorePackages: true, checkTypeImports: true },
        ],
      },
    },
    {
      // CLI output is for a human at a terminal, and entrypoints own their
      // process's exit code.
      files: [
        "server/src/scripts/**",
        "server/src/seed.ts",
        "server/src/index.ts",
        "server/src/worker.ts",
      ],
      rules: { "no-console": "off", "unicorn/no-process-exit": "off" },
    },
  ],
});
