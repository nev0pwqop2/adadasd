import * as React from "react"
import { cn } from "@/lib/utils"
import { motion, HTMLMotionProps } from "framer-motion"

export interface ButtonProps extends HTMLMotionProps<"button"> {
  variant?: "default" | "outline" | "ghost" | "danger"
  size?: "default" | "sm" | "lg" | "icon"
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "default", children, disabled, ...props }, ref) => {
    
    const baseStyles = "inline-flex items-center justify-center font-mono text-sm font-medium uppercase tracking-wider transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary disabled:pointer-events-none disabled:opacity-50 chamfered-btn"
    
    const variants = {
      default: "bg-primary text-primary-foreground hover:bg-primary/90 glow-box hover:glow-box-active",
      outline: "border border-primary text-primary hover:bg-primary/10",
      ghost: "text-foreground hover:bg-primary/10 hover:text-primary",
      danger: "bg-destructive/10 text-destructive border border-destructive hover:bg-destructive hover:text-destructive-foreground"
    }
    
    const sizes = {
      default: "h-10 px-6 py-2",
      sm: "h-8 px-4 text-xs",
      lg: "h-12 px-8 text-base",
      icon: "h-10 w-10"
    }

    return (
      <motion.button
        ref={ref}
        whileHover={{ scale: disabled ? 1 : 1.02 }}
        whileTap={{ scale: disabled ? 1 : 0.98 }}
        className={cn(baseStyles, variants[variant], sizes[size], className)}
        disabled={disabled}
        {...props}
      >
        <span className="relative z-10 flex items-center gap-2">
          {children}
        </span>
      </motion.button>
    )
  }
)
Button.displayName = "Button"

export { Button }
