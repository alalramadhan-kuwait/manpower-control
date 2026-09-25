/** Tell the app that data changed: the Notification Center badge refreshes. Called after every successful write. */
export const dataChanged = () => { if (typeof window !== 'undefined') window.dispatchEvent(new Event('notices-changed')); };
