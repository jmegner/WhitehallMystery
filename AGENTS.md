When doing almost anything...

- You should run `npm run build && npm run test` to make sure things compile and tests pass.
- If your work affects the web app, you should probably use Playwright to test things out.
- The human almost always has a "npm run dev" already going and looking at the app at localhost:5173; feel free to piggyback on that.

When writing the TypeScript+React side...

- Do not use useEffect; useEffect is synchronizing a React component with external systems (anything outside of React's state and props). We have no external systems. Everything is contained within our state and props.
- Most of the time you do not need useMemo. Ask me before using useMemo.
