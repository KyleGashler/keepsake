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
        "no-unused-vars": [
          "error",
          {
            ignoreRestSiblings: true,
            argsIgnorePattern: "^_",
            varsIgnorePattern: "^_",
            destructuredArrayIgnorePattern: "^_",
          },
        ],
        // TypeScript already catches these.
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

        "jsdoc/require-yields": "off",
        "no-underscore-dangle": [
          "error",
          {
            // Prisma's aggregate keys.
            allow: ["_all", "_avg", "_count", "_max", "_min", "_sum"],
          },
        ],
        "promise/always-return": ["error", { ignoreLastCallback: true }],
        "typescript/consistent-return": "off",
        "typescript/no-unnecessary-type-arguments": "off",
        "typescript/no-unsafe-type-assertion": "off",

        "no-await-in-loop": "off",
        "oxc/no-map-spread": "off",

        complexity: ["error", { max: 40, variant: "modified" }],
        "class-methods-use-this": ["error", { ignoreClassesWithImplements: "all" }],
        // Expo Router routes need a default export.
        "import/no-default-export": "off",
        "import/no-named-export": "off",
        "import/no-nodejs-modules": "off",
        // `import * as ImagePicker` is how Expo modules are documented.
        "import/no-namespace": "off",
        "import/no-relative-parent-imports": "off",
        "no-bitwise": "off",
        "no-eq-null": "off",
        "no-plusplus": "off",
        "no-undefined": "off",
        "no-use-before-define": "off",
        "no-void": "off",
        "node/no-process-env": "off",
        "node/no-top-level-await": "off",
        "oxc/no-async-await": "off",
        // Express 5 sends a rejected handler's error to the error middleware.
        "oxc/no-async-endpoint-handlers": "off",
        "oxc/no-optional-chaining": "off",
        "oxc/no-rest-spread-properties": "off",
        "typescript/explicit-function-return-type": "off",
        "typescript/explicit-member-accessibility": "off",
        "typescript/explicit-module-boundary-types": "off",
        "typescript/non-nullable-type-assertion-style": "off",
        "typescript/parameter-properties": "off",
        "typescript/promise-function-async": "off",
        "unicorn/no-array-for-each": "off",
        "unicorn/no-array-reduce": "off",
        "unicorn/prefer-number-properties": "off",

        "arrow-body-style": "off",
        "capitalized-comments": "off",
        curly: ["error", "multi-line"],
        "func-style": "off",
        "id-length": "off",
        "import/exports-last": "off",
        "import/group-exports": "off",
        "import/prefer-default-export": "off",
        "import/consistent-type-specifier-style": "off",
        "init-declarations": "off",
        "max-statements": "off",
        "max-params": ["error", { max: 5 }],
        // Flags `Router()` from Express.
        "new-cap": ["error", { capIsNew: false }],
        "no-continue": "off",
        "no-implicit-coercion": ["error", { allow: ["!!", "+"] }],
        "no-magic-numbers": "off",
        "no-ternary": "off",
        "node/callback-return": "off",
        "node/no-sync": "off",
        "one-var": ["error", "never"],
        "prefer-destructuring": "off",
        "prefer-named-capture-group": "off",
        "promise/avoid-new": "off",
        // Flags Express's `(err, req, res, next)` handler and `server.close(cb)`.
        "promise/prefer-await-to-callbacks": "off",
        "promise/prefer-await-to-then": "off",
        "sort-imports": "off",
        "sort-keys": "off",
        "typescript/consistent-type-assertions": [
          "error",
          {
            assertionStyle: "never",
          },
        ],
        "typescript/consistent-type-imports": [
          "error",
          { fixStyle: "inline-type-imports" },
        ],
        // Express's `Request` augmentation needs `interface`.
        "typescript/consistent-type-definitions": "off",
        "unicorn/catch-error-name": "off",
        "unicorn/custom-error-definition": "off",
        "unicorn/filename-case": ["error", { case: "kebabCase" }],
        "unicorn/no-await-expression-member": "off",
        "unicorn/no-nested-ternary": "off",
        // Prisma uses `null`.
        "unicorn/no-null": "off",
        "unicorn/number-literal-case": "off",
        "unicorn/numeric-separators-style": "off",
        "unicorn/prefer-export-from": "off",
        "unicorn/prefer-global-this": "off",
        "unicorn/switch-case-braces": "off",

        "no-array-constructor": "error",
        "no-case-declarations": "error",
        "no-fallthrough": "error",
        "no-prototype-builtins": "error",
        "typescript/ban-ts-comment": "error",
        "typescript/no-unsafe-function-type": "error",
        "typescript/no-unsafe-member-access": "error",
        "typescript/switch-exhaustiveness-check": [
          "error",
          { considerDefaultExhaustiveForUnions: true },
        ],

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
        // The React Compiler isn't enabled (`experiments.reactCompiler` in
        // app.json). These only report code the compiler can't optimize.
        "react/invariant": "off",
        "react/todo": "off",

        // React Native's `Alert.alert` isn't the browser's `alert`.
        "no-alert": "off",
        // Expo Router's `tabBarIcon: ({ color }) => <Ionicons … />` is a render
        // prop, not a component defined during render.
        "react/no-unstable-nested-components": ["error", { allowAsProps: true }],
        // `expo-status-bar` takes `style="light"`.
        "react/style-prop-object": ["error", { allow: ["StatusBar"] }],

        // React Native styles every component through `style`.
        "react/forbid-component-props": "off",
        "react/jsx-filename-extension": "off",
        "react/jsx-no-literals": "off",
        "react/no-multi-comp": "off",

        "react/jsx-max-depth": "off",
        // The new JSX transform doesn't need `React` in scope.
        "react/react-in-jsx-scope": "off",
        "react/hook-use-state": "off",
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
        "unicorn/filename-case": [
          "error",
          { cases: { kebabCase: true, pascalCase: true } },
        ],

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
      files: [
        "server/src/scripts/**",
        "server/src/seed.ts",
        "server/src/index.ts",
        "server/src/worker.ts",
      ],
      rules: { "no-console": "off", "unicorn/no-process-exit": "off" },
    },
    {
      // Types for an untyped package: `declare module "x"` only declares the
      // module from a script file (in a module it would be an augmentation).
      files: ["server/src/types/*.d.ts"],
      plugins: ["import"],
      rules: { "import/unambiguous": "off" },
    },
  ],
});
