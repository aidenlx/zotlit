<%= it.filter(lit => !!lit.citekey).map(lit => `@${lit.citekey}`).join("; ") %>
