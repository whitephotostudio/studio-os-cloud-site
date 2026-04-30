"use client";

import "./studio-os-motion.module.css";

import {
  CSSProperties,
  ReactNode,
  createElement,
  useCallback,
  useEffect,
  useState,
} from "react";

type RevealTag =
  | "article"
  | "aside"
  | "div"
  | "footer"
  | "header"
  | "main"
  | "section";

type RevealProps = {
  children: ReactNode;
  className?: string;
  delay?: number;
  as?: RevealTag;
  repeat?: boolean;
  style?: CSSProperties;
};

export function Reveal({
  children,
  className = "",
  delay = 0,
  as: Component = "div",
  repeat = false,
  style: customStyle,
}: RevealProps) {
  const [node, setNode] = useState<HTMLElement | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);

  const setNodeRef = useCallback((element: HTMLElement | null) => {
    setNode(element);
  }, []);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updateMotion = () => {
      setReduceMotion(mediaQuery.matches);
      if (mediaQuery.matches) setIsVisible(true);
    };

    updateMotion();
    mediaQuery.addEventListener("change", updateMotion);

    return () => mediaQuery.removeEventListener("change", updateMotion);
  }, []);

  useEffect(() => {
    if (reduceMotion || !node) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          if (!repeat) observer.unobserve(entry.target);
          return;
        }

        if (repeat) {
          setIsVisible(false);
        }
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.14 },
    );

    observer.observe(node);

    return () => observer.disconnect();
  }, [node, reduceMotion, repeat]);

  const style: CSSProperties = reduceMotion
    ? { ...customStyle }
    : { ...customStyle, transitionDelay: `${delay}ms` };

  return createElement(
    Component,
    {
      ref: setNodeRef,
      style,
      className: `studio-os-reveal-item ${isVisible ? "is-visible" : ""} ${className}`,
    },
    children,
  );
}
