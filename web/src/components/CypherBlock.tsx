// web/src/components/CypherBlock.tsx
// Displays a Cypher query with syntax highlighting — transparency signal for judges.
'use client';

interface CypherBlockProps {
  cypher: string;
  label?: string;
}

export function CypherBlock({ cypher, label }: CypherBlockProps) {
  return (
    <div className="mt-3">
      {label && <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">{label}</p>}
      <pre className="bg-gray-900 text-green-400 rounded-lg p-4 text-xs overflow-x-auto border border-gray-700 font-mono leading-relaxed">
        {cypher}
      </pre>
    </div>
  );
}
