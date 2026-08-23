import { getProjects } from "../data/projects";
import HomeClient from "../components/HomeClient";

export default function Home() {
  const projects = getProjects();
  return <HomeClient projects={projects} />;
}
