return {
	"github/copilot.vim",
	config = function()
		-- Disable default Tab mapping
		vim.g.copilot_no_tab_map = true

		-- Copilot keybindings (insert mode)
		-- Accept suggestion with Ctrl+Y
		vim.api.nvim_set_keymap("i", "<C-Y>", 'copilot#Accept("<CR>")', { silent = true, expr = true })

		-- Navigate suggestions with Alt+] and Alt+[
		vim.api.nvim_set_keymap("i", "<M-]>", "copilot#Next()", { silent = true, expr = true })
		vim.api.nvim_set_keymap("i", "<M-[>", "copilot#Previous()", { silent = true, expr = true })

		-- Dismiss suggestion with Ctrl+]
		vim.api.nvim_set_keymap("i", "<C-]>", "copilot#Dismiss()", { silent = true, expr = true })
	end,
}
