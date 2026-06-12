/** react → window.React（react16 UMD，与引擎/画布同一实例） */
/* eslint-disable @typescript-eslint/no-explicit-any */
const R = (window as any).React;
export default R;
export const {
  Children, Component, Fragment, PureComponent, StrictMode, Suspense,
  cloneElement, createContext, createElement, createFactory, createRef, forwardRef,
  isValidElement, lazy, memo, useCallback, useContext, useDebugValue, useEffect,
  useImperativeHandle, useLayoutEffect, useMemo, useReducer, useRef, useState, version,
} = R;
