When doing almost anything...

- You should run `npm run lint && npm run build && npm run test` to make sure things compile and tests pass.
  - Exception, if you're working on some image-related utility rather than the web app, you don't have to run those things.
- If your work affects the web app, you should probably use Playwright to test things out.

When writing the TypeScript+React side...

- Do not use useEffect; useEffect is synchronizing a React component with external systems (anything outside of React's state and props). We have no external systems. Everything is contained within our state and props.
- Most of the time you do not need useMemo. Ask me before using useMemo.

When manually testing the web app in a browser...

- Use a fresh, previously unused dev-server port for each QA session instead of reusing port 4173. Close the QA tab and stop the server afterward; do not click "New game" merely to clean up test state, because that can surface reset confirmations and reuse persisted state from the shared origin.
