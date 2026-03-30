import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useLocation } from 'wouter';

const variants = {
  initial: {
    opacity: 0,
    scale: 0.96,
    y: 24,
    filter: 'blur(8px)',
  },
  animate: {
    opacity: 1,
    scale: 1,
    y: 0,
    filter: 'blur(0px)',
  },
  exit: {
    opacity: 0,
    scale: 1.03,
    y: -16,
    filter: 'blur(6px)',
  },
};

const transition = {
  duration: 0.22,
  ease: [0.22, 1, 0.36, 1],
};

const exitTransition = {
  duration: 0.15,
  ease: [0.55, 0, 1, 0.45],
};

interface PageTransitionProps {
  children: React.ReactNode;
}

export default function PageTransition({ children }: PageTransitionProps) {
  const [location] = useLocation();

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={location}
        variants={variants}
        initial="initial"
        animate="animate"
        exit="exit"
        transition={{
          default: transition,
          exit: exitTransition,
          opacity: { duration: 0.25 },
          filter: { duration: 0.32 },
        }}
        style={{ willChange: 'transform, opacity, filter' }}
        className="flex-1 flex flex-col min-h-0"
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
