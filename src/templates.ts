export interface PaperTemplate {
  id: string;
  label: string;
  detail: string;
  classOptions: string;
  sections: boolean;
}

export const TEMPLATES: PaperTemplate[] = [
  {
    id: "prl",
    label: "Physical Review Letters",
    detail: "Two-column Letter (3750-word limit), no section headings",
    classOptions: "aps,prl,reprint,superscriptaddress",
    sections: false,
  },
  {
    id: "prb",
    label: "Physical Review B",
    detail: "Two-column regular article with sections",
    classOptions: "aps,prb,reprint,superscriptaddress",
    sections: true,
  },
  {
    id: "prx",
    label: "Physical Review X",
    detail: "Two-column article with sections",
    classOptions: "aps,prx,reprint,superscriptaddress",
    sections: true,
  },
  {
    id: "preprint",
    label: "APS preprint",
    detail: "Single-column, double-spaced draft for circulation or arXiv",
    classOptions: "aps,prb,preprint,superscriptaddress",
    sections: true,
  },
];

export function paperSource(template: PaperTemplate, bibName: string): string {
  const body = template.sections
    ? `\\section{Introduction}
Introduce the problem and state the main result~\\cite{example2024}.

\\section{Model}
Describe the model, e.g.\\ the Hamiltonian
\\begin{equation}
  H = \\sum_{i} \\epsilon_i \\, c_i^\\dagger c_i .
  \\label{eq:hamiltonian}
\\end{equation}

\\section{Results}
Present the results, referring to Eq.~\\eqref{eq:hamiltonian}.

\\section{Conclusion}
Summarize the findings.`
    : `Introduce the problem and state the main result~\\cite{example2024}.
Letters have no section headings; keep the text to 3750 words
(run "LaTeX: Check PRL Length" to count them the way APS does).

Describe the model, e.g.\\ the Hamiltonian
\\begin{equation}
  H = \\sum_{i} \\epsilon_i \\, c_i^\\dagger c_i .
  \\label{eq:hamiltonian}
\\end{equation}
and discuss the results, referring to Eq.~\\eqref{eq:hamiltonian}.`;

  return `\\documentclass[${template.classOptions}]{revtex4-2}

\\usepackage{graphicx}
\\usepackage{amsmath,amssymb}
\\usepackage{bm}
\\usepackage[dvipsnames]{xcolor}
\\usepackage[colorlinks=true,allcolors=blue]{hyperref}

\\begin{document}

\\title{Title of the Paper}

\\author{First Author}
\\email{first.author@example.org}
\\affiliation{Department of Physics, Example University, City, Country}

\\author{Second Author}
\\affiliation{Example Institute, City, Country}

\\date{\\today}

\\begin{abstract}
One paragraph summarizing the work.
\\end{abstract}

\\maketitle

${body}

% To add a figure, paste or drop an image into the editor, or:
% \\begin{figure}
%   \\includegraphics[width=\\linewidth]{figures/example}
%   \\caption{Describe the figure.}
%   \\label{fig:example}
% \\end{figure}

\\begin{acknowledgments}
We thank \\ldots
\\end{acknowledgments}

\\bibliography{${bibName.replace(/\.bib$/i, "")}}

\\end{document}
`;
}

export const STARTER_BIB = `@article{example2024,
  author  = {Author, First and Author, Second},
  title   = {An Example Reference},
  journal = {Phys. Rev. Lett.},
  volume  = {132},
  pages   = {010101},
  year    = {2024},
}
`;
