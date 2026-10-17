/** The playbook name and step under a body, in the secondary colour. Names and numbers only. */
export function SourceLine({ text }: { text: string }) {
  return <p className="guided-source">{text}</p>;
}
