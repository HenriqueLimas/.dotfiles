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
		})

		vim.keymap.set("n", "<leader>a", function()
			harpoon:list("files"):add()
		end)
		vim.keymap.set("n", "<C-e>", function()
			harpoon.ui:toggle_quick_menu(harpoon:list("files"))
		end)

		vim.keymap.set("n", "<leader>1", function()
			harpoon:list("files"):select(1)
		end)
		vim.keymap.set("n", "<leader>2", function()
			harpoon:list("files"):select(2)
		end)
		vim.keymap.set("n", "<leader>3", function()
			harpoon:list("files"):select(3)
		end)
		vim.keymap.set("n", "<leader>4", function()
			harpoon:list("files"):select(4)
		end)

		-- Toggle previous & next buffers stored within Harpoon list
		vim.keymap.set("n", "<C-S-P>", function()
			harpoon:list("files"):prev()
		end)
		vim.keymap.set("n", "<C-S-N>", function()
			harpoon:list("files"):next()
		end)
	end,
}
