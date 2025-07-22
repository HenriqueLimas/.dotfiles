return {
	"ThePrimeagen/harpoon",
	branch = "harpoon2",
	dependencies = { "nvim-lua/plenary.nvim" },
	config = function()
		local harpoon = require("harpoon")

		harpoon:setup({
			settings = {
				sync_on_ui_close = true,
				save_on_toggle = true,
			},
			files = {},
			terminal = {},
		})

		vim.keymap.set("n", "<leader>fa", function()
			harpoon:list("files"):add()
		end)
		vim.keymap.set("n", "<leader>fe", function()
			harpoon.ui:toggle_quick_menu(harpoon:list("files"))
		end)

		vim.keymap.set("n", "<leader>fh", function()
			harpoon:list("files"):select(1)
		end)
		vim.keymap.set("n", "<leader>fj", function()
			harpoon:list("files"):select(2)
		end)
		vim.keymap.set("n", "<leader>fk", function()
			harpoon:list("files"):select(3)
		end)
		vim.keymap.set("n", "<leader>fl", function()
			harpoon:list("files"):select(4)
		end)

		-- Toggle previous & next buffers stored within Harpoon list
		vim.keymap.set("n", "<C-S-P>", function()
			harpoon:list("files"):prev()
		end)
		vim.keymap.set("n", "<C-S-N>", function()
			harpoon:list("files"):next()
		end)

		-- TERMINAL
		vim.keymap.set("n", "<leader>ta", function()
			vim.cmd.term()
			harpoon:list("terminal"):add()
			local idx = harpoon:list("terminal"):length() - 1

			local term_group = vim.api.nvim_create_augroup("TermGroup", { clear = true })

			vim.api.nvim_create_autocmd("TermClose", {
				group = term_group,
				pattern = "term://*",
				callback = function()
					harpoon:list("terminal"):remove_at(idx)
				end,
			})
		end)

		vim.keymap.set("n", "<leader>te", function()
			harpoon.ui:toggle_quick_menu(harpoon:list("terminal"))
		end)

		vim.keymap.set("n", "<leader>td", function()
			harpoon:list("terminal"):select(1)
		end)
		vim.keymap.set("n", "<leader>tf", function()
			harpoon:list("terminal"):select(2)
		end)
	end,
}
