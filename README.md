# bacadra-tools

Commands and snippets for Bacadra engineering workflows.

## Features

- **Workflow shortcuts**: open configured calculation, foundation, task, download, and Unicode resources.
- **Editing commands**: swap signs and revert the active buffer from disk.
- **Eurocode citations**: convert national citation keys into annex-neutral Bacadra tokens.
- **Project helpers**: create Bacadra `.gitignore` files beside tree-view selections.
- **Jupyter integration**: clear the active Bacadra cache through the running kernel.
- **Python snippets**: insert Bacadra sections, equations, pictures, items, and raw strings.

## Installation

To install `bacadra-tools` search for it in the Install pane of the Lumine settings, or run the command `lumine --install lumine-code/bacadra-tools`.

## Commands

Commands available in `lumine-workspace`:

- `bacadra-tools:open-calc`: open the configured calculation resource,
- `bacadra-tools:open-fund`: open the configured foundation resource,
- `bacadra-tools:open-todo`: open the configured task resource,
- `bacadra-tools:open-ytdl`: open the configured download script,
- `bacadra-tools:unicode-readme`: preview the configured Unicode reference,
- `bacadra-tools:signer`: swap plus and minus signs in each selection,
- `bacadra-tools:revert`: reload the active file from disk,
- `bacadra-tools:cdb-clear`: clear Bacadra's cache through the active Jupyter kernel,
- `bacadra-tools:generalize-cites`: replace national Eurocode keys with annex-neutral tokens,
- `bacadra-tools:create-gitignore`: create a Bacadra `.gitignore` beside each tree selection,
- `bacadra-tools:ligatures`: toggle font ligatures.

## Services

- `tree-view.selection`: consumed to read directories and files selected in the tree view.
- `jupyter.kernel`: consumed to clear Bacadra's cache through the active kernel.

## Contributing

Got ideas to make this package better, found a bug, or want to help add new features? Just drop your thoughts on GitHub. Any feedback is welcome!
