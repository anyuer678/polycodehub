"use client";

import CodeMirror from '@uiw/react-codemirror';
import { githubLight } from '@uiw/codemirror-theme-github';
import { python } from '@codemirror/lang-python';
import { java } from '@codemirror/lang-java';
import { javascript } from '@codemirror/lang-javascript';
import { cpp } from '@codemirror/lang-cpp';
import { EditorView, keymap } from '@codemirror/view';
import type { Extension } from '@codemirror/state';
import { useMemo } from 'react';

const EXTENSIONS: Record<string, ReturnType<typeof python>> = {
  python: python(),
  java: java(),
  javascript: javascript(),
  node: javascript(),
  cpp: cpp(),
  c: cpp()
};

interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  language: string;
  disabled?: boolean;
  onCtrlEnter?: () => void;
}

export default function CodeEditor({ value, onChange, language, disabled, onCtrlEnter }: CodeEditorProps) {
  const extensions = useMemo(() => {
    const list: Extension[] = [
      EXTENSIONS[language] || python(),
      EditorView.lineWrapping
    ];
    if (onCtrlEnter) {
      list.push(
        keymap.of([
          {
            key: 'Mod-Enter',
            run: () => {
              onCtrlEnter();
              return true;
            }
          }
        ])
      );
    }
    return list;
  }, [language, onCtrlEnter]);

  return (
    <div className="editor-wrap">
      <CodeMirror
        value={value}
        onChange={onChange}
        theme={githubLight}
        extensions={extensions}
        editable={!disabled}
        basicSetup={{
          lineNumbers: true,
          highlightActiveLine: true,
          highlightActiveLineGutter: true,
          foldGutter: true,
          autocompletion: false,
          indentOnInput: true,
          tabSize: 4
        }}
        height="100%"
        style={{ fontFamily: '"JetBrains Mono", Consolas, monospace', fontSize: 13 }}
      />
    </div>
  );
}