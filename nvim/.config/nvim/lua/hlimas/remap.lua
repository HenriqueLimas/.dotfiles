vim.g.mapleader = " "
vim.keymap.set("n", "-", vim.cmd.Ex)

vim.keymap.set("n", "gd", vim.lsp.buf.definition)

vim.keymap.set({ "n", "v" }, "<leader>y", [["+y]])
vim.keymap.set("n", "<leader>Y", [["+Y]])

vim.api.nvim_create_user_command(
	"W",
	"write",
	{ nargs = "?", complete = "file", desc = "Save current file (alias for :w)" }
)
vim.api.nvim_create_user_command("Q", "quit", { bang = true, desc = "Quite current window (alias for :q)" })

vim.keymap.set("n", "<C-f>", "<cmd>silent !tmux neww tmux-sessionizer<CR>")
vim.keymap.set("n", "<leader>f", function()
	require("conform").format({ bufnr = 0 })
end)

vim.keymap.set("n", "<tab>", "<cmd>noh<cr>")

vim.keymap.set("x", "<leader>p", [["_dP]], { desc = "Paste without losing the content" })

vim.keymap.set(
	"n",
	"<leader>s",
	[[:%s/\<<C-r><C-w>\>/<C-r><C-w>/gI<Left><Left><Left>]],
	{ desc = "Find all selected and replace" }
)

vim.keymap.set("v", "K", ":m '<-2<CR>gv=gv", { desc = "Move whole line up" })
vim.keymap.set("v", "J", ":m '>+1<CR>gv=gv", { desc = "Move whole line down" })

vim.keymap.set("n", "<C-b><C-b>", "<C-b>", { desc = "Scroll up one page" })

vim.keymap.set("n", "<C-d>", "<C-d>zz", { desc = "Maintain center cursor on going down" })
vim.keymap.set("n", "<C-u>", "<C-u>zz", { desc = "Maintain center cursor on going up" })

vim.keymap.set("t", "<C-q>", "<C-\\><C-n>", { desc = "Exit terminal mode" })

vim.keymap.set("n", "<leader>z", "<cmd>ZenMode<cr>")
