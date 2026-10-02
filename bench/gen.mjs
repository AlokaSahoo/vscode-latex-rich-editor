// Generates a large synthetic REVTeX paper for benchmarking: node bench/gen.mjs [sections] > file.tex
const sections = Number(process.argv[2] ?? 100);
const out = ["\\documentclass[reprint]{revtex4-2}", "\\newcommand{\\half}{\\frac{1}{2}}", "\\begin{document}", "\\title{Benchmark}", "\\begin{abstract}Words words words.\\end{abstract}", "\\maketitle"];
for (let i = 0; i < sections; i++) {
  out.push(`\\section{Section ${i}}\\label{sec:${i}}`);
  out.push(`Lorem ipsum \\textbf{dolor} sit amet, \\emph{consectetur} adipiscing elit, see Eq.~\\eqref{eq:${i}} and Fig.~\\ref{fig:${i}} \\cite{ref${i % 20}}. Inline $a_${i}+b^2=\\half c$ math here and more text to make the paragraph long enough to wrap onto several lines in the editor view.`);
  out.push("", `\\begin{equation}\n  E_${i} = \\half m c^2 + \\sum_{k=0}^{${i}} \\frac{x_k}{y_k} \\label{eq:${i}}\n\\end{equation}`, "");
  out.push(`\\begin{align}\n  a &= b + ${i} \\\\\n  c &= d\n\\end{align}`, "");
  out.push(`\\begin{figure}\n  \\includegraphics[width=\\linewidth]{figs/f${i}}\n  \\caption{Caption for figure ${i}.}\\label{fig:${i}}\n\\end{figure}`, "");
  if (i % 5 === 0) out.push(`\\begin{table}\\caption{Table ${i}}\\begin{tabular}{cc}a&b\\\\c&d\\end{tabular}\\end{table}`, "");
  out.push("More prose after the floats. ".repeat(6), "");
}
out.push("\\bibliography{refs}", "\\end{document}");
console.log(out.join("\n"));
