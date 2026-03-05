import { Deployment, RoutingContext } from '../types/routing';

export interface IRoutingStrategy {
  select(deployments: Deployment[], context: RoutingContext): Deployment;
}
