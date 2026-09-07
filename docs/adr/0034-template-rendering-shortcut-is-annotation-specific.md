# The template rendering shortcut is annotation-specific

> **Amended by [ADR 0035](0035-profile-annotation-section.md).** During Profile rendering, the shortcut and native annotation calls use the Profile's final Annotation Section. Generic named-template rendering retains the lookup recorded here.

ZotLit provides a shortcut for rendering one annotation with its data bound to
`zt`, so template authors supply the annotation without choosing a variable
name. Default annotation call sites use the shortcut, and the documentation
shows the equivalent native template syntax for advanced use. The shortcut
is annotation-specific because native partial rendering already serves general
template composition; a general named-template helper adds an interface this
use case does not need.

The shortcut resolves the named `annotation` partial through the existing
template lookup. It is exactly equivalent to Liquid's
`{% render "annotation" with annotation as zt %}` or Eta's
`<%~ include("annotation", annotation) %>`. The Profile's Annotation Block
remains a separate rendering target.

The authoring forms are `{% render_annotation annotation %}` in Liquid and
`<%~ renderAnnotation(annotation) %>` in Eta. Both require an annotation
argument and report an error for missing or null data. Bundled annotation
calls and their documentation adopt these forms; existing user templates
retain their source and native partial calls remain supported.
