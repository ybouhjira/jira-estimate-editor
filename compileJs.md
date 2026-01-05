````markdown
# Compiling TypeScript Files

All **TypeScript (TS)** files need to be placed in the `src` folder.

## Updating Script Tags in HTML

When referencing compiled JavaScript files in your HTML, make sure to change the script tag:

**Before:**

```html
<script src="popup.js"></script>
```
````

**After:**

```html
<script type="module" src="/dist/popup.js"></script>
```

## Compiling TS Files

After modifying or adding a `.ts` file, run the following command in the terminal:

```bash
npx tsc
```

This will compile your TypeScript files into JavaScript.

## Notes

- Ensure your TS files are saved in `src` before running the compiler.
- The compiled JS files will be output in the `dist` folder.
- Always update your HTML script tags to use `type="module"` when using compiled TS.

```

```
